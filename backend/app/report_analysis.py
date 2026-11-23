"""事实报告的可选 AI 分析；只消费已保存快照，且不进入报告生成关键路径。"""

import json
import os
import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError

from app.ai_batching import (
    DatabaseCheckpoints,
    batch_config,
    input_fingerprint,
    preflight_budget,
    run_fingerprint,
    semantic_batches,
)
from app.ai_config import save_request_logs, selected_snapshot_payload
from app.ai_global_state import _read_state
from app.ai_invocation import (
    AiInvocationCancelled,
    AiInvocationLease,
    begin_invocation,
    get_active_invocation,
    request_invocation_cancel,
)
from app.database import open_database
from app.fact_report_models import ReportAnalysis, ReportAnalysisOutput
from app.report_analysis_batching import run_batches, validate_report_output
from app.report_analysis_inputs import (
    analysis_input as _analysis_input,
)
from app.report_analysis_inputs import (
    build_mock_analysis,
)
from app.settings import configured_api_key, current_settings, get_provider_adapter
from app.siliconflow import ModelErrorKind, SiliconFlowError
from app.structured_repair import RepairBudget, normalize_refs, run_repair_ladder

router = APIRouter(prefix="/api/fact-reports/{report_id}/analysis", tags=["report analysis"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _not_enabled() -> ReportAnalysis:
    return ReportAnalysis(status="not_enabled", message="AI 分析未启用", output=None)


def _configuration() -> tuple[str, str, str, bool] | None:
    """报告分析跟随当前 AI 配置：默认 auto，前面的 AI 步骤能用，这里也能用。"""
    mode = os.getenv("REPORT_ANALYSIS_MODE", "auto")
    if mode == "disabled":
        return None
    if mode == "mock":
        return "mock", "mock-report-analysis-v1", "", True
    settings = current_settings()
    if settings.mode == "mock":
        # 与其它 AI 步骤保持一致：模拟模式也要产出模拟分析，而不是“未配置”。
        return "mock", "mock-report-analysis-v1", "", True
    api_key = configured_api_key(settings.provider)
    if not settings.provider or not api_key:
        return None
    return settings.provider, settings.model, api_key, False


def analysis_is_enabled(connection: sqlite3.Connection) -> bool:
    """事实报告在 AI 关闭时独立生成，既不排队也不留下假 pending。"""
    state = _read_state(connection)
    return state.enabled and state.can_enable and _configuration() is not None


def _from_row(row: sqlite3.Row) -> ReportAnalysis:
    keys = set(row.keys())

    def value(name: str, default=None):
        return row[name] if name in keys else default

    common = {
        "run_id": value("id"),
        "fingerprint": value("fingerprint") or None,
        "stage": value("stage") or None,
        "elapsed_ms": value("elapsed_ms"),
    }
    if row["status"] == "pending":
        return ReportAnalysis(status="pending", message="AI 分析正在运行", output=None, **common)
    if row["status"] == "completed":
        return ReportAnalysis(
            status="completed",
            message="AI 分析已完成",
            output=ReportAnalysisOutput.model_validate_json(row["output"]),
            **common,
        )
    return ReportAnalysis(
        status=row["status"],
        message=f"分析未完成：{row['error']}",
        output=None,
        error=(json.loads(row["error_detail"]) if "error_detail" in keys and row["error_detail"] else None),
        **common,
    )


def latest_analysis(connection: sqlite3.Connection, report_id: int) -> ReportAnalysis:
    active = connection.execute(
        """SELECT cancel_requested_at FROM ai_active_invocation
           WHERE status = 'running' AND operation_type = 'report_analysis' AND resource_id = ?""",
        (report_id,),
    ).fetchone()
    if active is not None:
        stopping = active["cancel_requested_at"] is not None
        return ReportAnalysis(
            status="pending",
            message="AI 分析正在停止" if stopping else "AI 分析正在运行",
            output=None,
            stopping=stopping,
        )
    # 初次报告创建期间 pending 可能先于全局租约入库，应优先展示待运行状态。
    pending = connection.execute(
        "SELECT * FROM report_analysis_runs WHERE report_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
        (report_id,),
    ).fetchone()
    if pending is not None:
        return _from_row(pending)
    row = connection.execute(
        """SELECT * FROM report_analysis_runs WHERE report_id = ? AND is_visible = 1
           ORDER BY is_active DESC, id DESC LIMIT 1""",
        (report_id,),
    ).fetchone()
    return _from_row(row) if row else _not_enabled()


def find_reusable_analysis(connection: sqlite3.Connection, report_id: int, fingerprint: str) -> sqlite3.Row | None:
    """相同指纹已有成功结果时才允许复用；失败运行不参与。"""
    return connection.execute(
        """SELECT * FROM report_analysis_runs
           WHERE report_id = ? AND fingerprint = ? AND status = 'completed' AND is_visible = 1
           ORDER BY id DESC LIMIT 1""",
        (report_id, fingerprint),
    ).fetchone()


def analysis_history(connection: sqlite3.Connection, report_id: int) -> list[dict[str, object]]:
    """历史运行与当前活动视图分开；按时间倒序返回摘要。"""
    rows = connection.execute(
        """SELECT id, status, fingerprint, stage, elapsed_ms, is_active, created_at
           FROM report_analysis_runs WHERE report_id = ? AND is_visible = 1 ORDER BY id DESC""",
        (report_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def enqueue_analysis(connection: sqlite3.Connection, report_id: int) -> None:
    configuration = _configuration()
    if configuration is None:
        return
    provider, model, _, is_mock = configuration
    connection.execute(
        """INSERT INTO report_analysis_runs
           (report_id, status, provider, model, is_mock, input_snapshot, output, error,
            created_at, completed_at, config_snapshot)
           VALUES (?, 'pending', ?, ?, ?, '{}', NULL, NULL, ?, ?, ?)""",
        (
            report_id,
            provider,
            model,
            int(is_mock),
            _now(),
            _now(),
            json.dumps(selected_snapshot_payload(), ensure_ascii=False),
        ),
    )


def _save(
    connection: sqlite3.Connection,
    report_id: int,
    analysis_input: dict[str, object],
    *,
    provider: str,
    model: str,
    is_mock: bool,
    output: ReportAnalysisOutput | None,
    error: str | None,
    error_detail: dict[str, object] | None = None,
    stage: str = "report_analysis",
    elapsed_ms: int | None = None,
    reused_from_id: int | None = None,
    lease: AiInvocationLease | None = None,
    config_snapshot: dict[str, object] | None = None,
    overwrite_previous: bool = False,
) -> ReportAnalysis:
    snapshot = config_snapshot if config_snapshot is not None else selected_snapshot_payload()
    if lease is not None:
        connection.execute("BEGIN IMMEDIATE")
        lease.assert_can_commit(connection)
    fingerprint = run_fingerprint(analysis_input, snapshot, model, "report-analysis-v1")
    # Only a fully validated output may replace the effective result.
    # A failed/partial retry remains auditable without masking the previous success.
    if output is not None:
        connection.execute(
            "UPDATE report_analysis_runs SET is_active = 0 WHERE report_id = ?",
            (report_id,),
        )
    if output is not None and overwrite_previous:
        connection.execute(
            "UPDATE report_analysis_runs SET is_visible = 0 WHERE report_id = ? AND status = 'completed'",
            (report_id,),
        )
    connection.execute(
        """INSERT INTO report_analysis_runs
           (report_id, status, provider, model, is_mock, input_snapshot, output, error,
            created_at, completed_at, config_snapshot, error_detail, fingerprint,
            stage, elapsed_ms, reused_from_id, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            report_id,
            "completed" if output else "failed",
            provider,
            model,
            int(is_mock),
            json.dumps(analysis_input, ensure_ascii=False, sort_keys=True),
            output.model_dump_json() if output else None,
            error,
            _now(),
            _now(),
            json.dumps(snapshot, ensure_ascii=False),
            json.dumps(error_detail or {}, ensure_ascii=False),
            fingerprint,
            stage,
            elapsed_ms,
            reused_from_id,
            int(output is not None),
        ),
    )
    if lease is not None:
        # 已完成本次运行，清除自动生成阶段的占位记录，避免永久 pending。
        connection.execute(
            "DELETE FROM report_analysis_runs WHERE report_id = ? AND status = 'pending' AND is_active = 0",
            (report_id,),
        )
        # 必须在释放全局租约前提交结果，防止取消/下一调用抢先进入。
        connection.commit()
    saved = connection.execute(
        "SELECT * FROM report_analysis_runs WHERE report_id = ? ORDER BY id DESC LIMIT 1",
        (report_id,),
    ).fetchone()
    return _from_row(saved)


def _run_batched_analysis(
    *,
    report_id: int,
    analysis_input: dict[str, object],
    valid_refs: set[str],
    provider: str,
    model: str,
    api_key: str,
    adapter,
    config,
    lease: AiInvocationLease,
) -> ReportAnalysisOutput:
    """多批分析：按模块/记录切批，截断二分，检查点恢复。"""
    adapter.max_calls = config.call_limit
    fingerprint = input_fingerprint(analysis_input, str(lease.config_snapshot["fingerprint"]), model)

    def call_model(batch: dict[str, object]) -> dict[str, object]:
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消")
        response = adapter.generate_json(
            api_key=api_key,
            model=model,
            evidence_json=json.dumps(batch, ensure_ascii=False),
            system_prompt=(
                "只返回当前批次的报告分析 JSON：risks、additional_verifications、"
                "regression_recommendations 和 stage_recommendation。"
                "每项必须引用当前批次内的 evidence_refs；不得补充阈值或修改事实。"
            ),
            prompt_version="report-analysis-batch-v1",
            stage="report_analysis_batch",
        )
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消；迟到输出已丢弃")
        return response

    def ensure_active() -> bool:
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消")
        return False

    return run_batches(
        semantic_batches(analysis_input, config),
        call_model=call_model,
        valid_refs=valid_refs,
        checkpoints=DatabaseCheckpoints(report_id, fingerprint, lease=lease),
        config=config,
        cancel_event=ensure_active,
    )


def _report_analysis_input(connection: sqlite3.Connection, report_id: int) -> tuple[dict[str, object], set[str], int]:
    """仅在启动时读取画像/版本说明，绝不回写事实报告快照。"""
    row = connection.execute(
        """SELECT report.snapshot, version.project_id, version.ai_context, project.product_profile
           FROM online_reports report
           JOIN product_versions version ON version.id = report.product_version_id
           JOIN projects project ON project.id = version.project_id
           WHERE report.id = ?""",
        (report_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="事实报告不存在")
    analysis_input, valid_refs = _analysis_input(json.loads(row["snapshot"]))
    try:
        profile = json.loads(row["product_profile"]) if row["product_profile"] else None
    except (ValueError, TypeError):
        profile = None
    analysis_input["product_profile"] = profile
    analysis_input["version_ai_context"] = row["ai_context"] or ""
    return analysis_input, valid_refs, int(row["project_id"])


def _record_cancelled(
    report_id: int,
    *,
    provider: str,
    model: str,
    is_mock: bool,
    analysis_input: dict[str, object],
    config_snapshot: dict[str, object],
) -> None:
    """取消只记运行状态；已有有效输出和检查点保持原样。"""
    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        prior = connection.execute(
            """SELECT id FROM report_analysis_runs
               WHERE report_id = ? AND is_active = 1 AND status = 'completed'
               LIMIT 1""",
            (report_id,),
        ).fetchone()
        active = 0 if prior else 1
        pending = connection.execute(
            """SELECT id FROM report_analysis_runs
               WHERE report_id = ? AND status = 'pending'
               ORDER BY id DESC LIMIT 1""",
            (report_id,),
        ).fetchone()
        if pending:
            connection.execute(
                """UPDATE report_analysis_runs
                   SET status = 'cancelled', error = '用户已取消 AI 分析',
                       completed_at = ?, is_active = ?
                   WHERE id = ?""",
                (_now(), active, pending["id"]),
            )
        else:
            connection.execute(
                """INSERT INTO report_analysis_runs
                   (report_id, status, provider, model, is_mock, input_snapshot,
                    output, error, created_at, completed_at, config_snapshot, is_active)
                   VALUES (?, 'cancelled', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)""",
                (
                    report_id,
                    provider,
                    model,
                    int(is_mock),
                    json.dumps(analysis_input, ensure_ascii=False, sort_keys=True),
                    "用户已取消 AI 分析",
                    _now(),
                    _now(),
                    json.dumps(config_snapshot, ensure_ascii=False),
                    active,
                ),
            )


def _perform_analysis(
    connection: sqlite3.Connection,
    report_id: int,
    *,
    force: bool,
    overwrite_previous: bool,
    lease: AiInvocationLease,
    analysis_input: dict[str, object],
    valid_refs: set[str],
    provider: str,
    model: str,
    api_key: str,
    is_mock: bool,
) -> ReportAnalysis:
    config_snapshot = dict(lease.config_snapshot)
    fingerprint = run_fingerprint(analysis_input, config_snapshot, model, "report-analysis-v1")
    if not force:
        reusable = find_reusable_analysis(connection, report_id, fingerprint)
        if reusable is not None:
            return _from_row(reusable).model_copy(
                update={"reused": True, "message": f"复用运行 #{reusable['id']}，未重复调用模型"}
            )
    save_options = {
        "provider": provider,
        "model": model,
        "is_mock": is_mock,
        "lease": lease,
        "config_snapshot": config_snapshot,
        "overwrite_previous": overwrite_previous,
    }
    if is_mock:
        return _save(
            connection,
            report_id,
            analysis_input,
            output=build_mock_analysis(analysis_input),
            error=None,
            **save_options,
        )

    adapter = None
    try:
        adapter = get_provider_adapter(provider)
        if hasattr(adapter, "network_mode"):
            adapter.network_mode = str(config_snapshot.get("network_mode", "auto"))
        config = batch_config()
        adapter.max_calls = config.call_limit
        batches = semantic_batches(analysis_input, config)
        if len(batches) > 1:
            output = _run_batched_analysis(
                report_id=report_id,
                analysis_input=analysis_input,
                valid_refs=valid_refs,
                provider=provider,
                model=model,
                api_key=api_key,
                adapter=adapter,
                config=config,
                lease=lease,
            )
        else:
            preflight_budget(json.dumps(analysis_input, ensure_ascii=False), config)
            if lease.cancel_requested():
                raise AiInvocationCancelled("报告 AI 分析已取消")
            raw_output = adapter.generate_json(
                api_key=api_key,
                model=model,
                evidence_json=json.dumps(analysis_input, ensure_ascii=False),
                system_prompt=(
                    "只返回报告分析 JSON：risks、additional_verifications、regression_recommendations 和 "
                    "stage_recommendation。"
                    "每项都必须附现有 evidence_refs；只能给建议，不能补充阈值、修改事实或实施质量门禁。"
                ),
                prompt_version="report-analysis-v1",
                stage="report_analysis",
            )
            if lease.cancel_requested():
                raise AiInvocationCancelled("报告 AI 分析已取消；迟到输出已丢弃")

            def repair(prompt: str) -> str:
                if lease.cancel_requested():
                    raise AiInvocationCancelled("报告 AI 分析已取消")
                repaired = adapter.generate_json(
                    api_key=api_key,
                    model=model,
                    evidence_json=json.dumps(
                        {"repair_instruction": prompt, "report_input": analysis_input},
                        ensure_ascii=False,
                    ),
                    system_prompt="按修复指令只返回报告分析 JSON；不得新增、删除或改写业务事实。",
                    prompt_version="report-analysis-repair-v1",
                    stage="report_analysis_repair",
                )
                if lease.cancel_requested():
                    raise AiInvocationCancelled("报告 AI 分析已取消；修复输出已丢弃")
                return json.dumps(repaired, ensure_ascii=False)

            output, _steps = run_repair_ladder(
                raw_output,
                validate=lambda data: validate_report_output(data, valid_refs),
                normalize=lambda data: normalize_refs(data, "stage_progress"),
                repair=repair,
                budget=RepairBudget(getattr(adapter, "max_calls", 40) - getattr(adapter, "call_count", 0)),
                fallback_ref="stage_progress",
                fields=[
                    "risks",
                    "additional_verifications",
                    "regression_recommendations",
                    "stage_recommendation",
                ],
                allowed_refs=sorted(valid_refs),
            )
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消")
    except AiInvocationCancelled:
        raise
    except (SiliconFlowError, ValidationError, ValueError) as error:
        if isinstance(error, SiliconFlowError):
            detail = error.to_dict()
            message = "模型分析结构无效" if error.kind == ModelErrorKind.SCHEMA_VALIDATION else str(error)
        else:
            detail = SiliconFlowError(
                ModelErrorKind.SCHEMA_VALIDATION,
                "模型分析结构无效",
                False,
                stage="report_analysis",
                provider=provider,
                model=model,
            ).to_dict()
            message = "模型分析结构无效"
        return _save(
            connection, report_id, analysis_input, output=None, error=message, error_detail=detail, **save_options
        )
    except Exception:
        detail = SiliconFlowError(
            ModelErrorKind.TEMPORARY_SERVICE,
            "模型服务不可用",
            False,
            stage="report_analysis",
            provider=provider,
            model=model,
        ).to_dict()
        return _save(
            connection,
            report_id,
            analysis_input,
            output=None,
            error="模型服务不可用",
            error_detail=detail,
            **save_options,
        )
    finally:
        if adapter is not None:
            save_request_logs(getattr(adapter, "request_logs", []))
    return _save(connection, report_id, analysis_input, output=output, error=None, **save_options)


def run_analysis(
    connection: sqlite3.Connection, report_id: int, *, force: bool = False,
    overwrite_previous: bool = False,
) -> ReportAnalysis:
    analysis_input, valid_refs, project_id = _report_analysis_input(connection, report_id)
    configuration = _configuration()
    if configuration is None:
        return _not_enabled()
    provider, model, api_key, is_mock = configuration
    proposed = selected_snapshot_payload()
    lease = begin_invocation(
        operation_type="report_analysis",
        project_id=project_id,
        resource_id=report_id,
        execution_mode="checkpointed_batch",
        input_fingerprint=input_fingerprint(analysis_input, str(proposed.get("fingerprint", provider)), model),
    )
    config_snapshot = dict(lease.config_snapshot)
    if not is_mock:
        provider = str(config_snapshot["provider"])
        model = str(config_snapshot["model"])
        api_key = configured_api_key(provider)
    outcome = "failed"
    try:
        result = _perform_analysis(
            connection,
            report_id,
            force=force,
            overwrite_previous=overwrite_previous,
            lease=lease,
            analysis_input=analysis_input,
            valid_refs=valid_refs,
            provider=provider,
            model=model,
            api_key=api_key,
            is_mock=is_mock,
        )
        outcome = "completed" if result.status == "completed" else "failed"
        return result
    except AiInvocationCancelled:
        connection.rollback()
        _record_cancelled(
            report_id,
            provider=provider,
            model=model,
            is_mock=is_mock,
            analysis_input=analysis_input,
            config_snapshot=config_snapshot,
        )
        outcome = "cancelled"
        return ReportAnalysis(status="cancelled", message="AI 分析已取消", output=None)
    finally:
        # 只有模型已返回/超时且结果提交或取消收尾完成，才释放全局占用。
        lease.finish(outcome)


@router.get("/repeat-info")
def report_repeat_info(report_id: int) -> dict[str, object]:
    """Read-only comparison; execution still goes through the global AI lease."""
    with open_database() as connection:
        analysis_input, _, _ = _report_analysis_input(connection, report_id)
        configuration = _configuration()
        if configuration is None:
            return {
                "same_input": False, "has_previous": False,
                "running_same_operation": False, "occupied_other": False,
            }
        _, model, _, _ = configuration
        fingerprint = run_fingerprint(analysis_input, selected_snapshot_payload(), model, "report-analysis-v1")
        previous = connection.execute(
            "SELECT 1 FROM report_analysis_runs WHERE report_id = ? AND status = 'completed' AND is_visible = 1",
            (report_id,),
        ).fetchone()
        active = get_active_invocation().active
        return {
            "same_input": find_reusable_analysis(connection, report_id, fingerprint) is not None,
            "has_previous": previous is not None,
            "occupied_other": bool(
                active and not (active.operation_type == "report_analysis" and active.resource_id == report_id)
            ),
            "running_same_operation": bool(
                active and active.operation_type == "report_analysis" and active.resource_id == report_id
            ),
        }


@router.post("", response_model=ReportAnalysis, status_code=status.HTTP_201_CREATED)
def retry_report_analysis(report_id: int, force: bool = False, overwrite_previous: bool = False) -> ReportAnalysis:
    with open_database() as connection:
        return run_analysis(connection, report_id, force=force, overwrite_previous=overwrite_previous)


@router.post("/cancel")
def cancel_report_analysis(report_id: int) -> dict[str, bool]:
    """只取消指定报告的 AI 调用；真正收尾由执行线程完成。"""
    with open_database() as connection:
        if connection.execute("SELECT id FROM online_reports WHERE id = ?", (report_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="事实报告不存在")
    active = get_active_invocation().active
    if active and active.operation_type == "report_analysis" and active.resource_id == report_id:
        request_invocation_cancel(active.invocation_id)
        return {"cancel_requested": True, "stopping": True}
    # 自动生成后的背景启动空隙：还未取得租约时允许取消尚未开始的任务。
    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        pending = connection.execute(
            """SELECT id FROM report_analysis_runs
               WHERE report_id = ? AND status = 'pending'
               ORDER BY id DESC LIMIT 1""",
            (report_id,),
        ).fetchone()
        if pending is None:
            raise HTTPException(status_code=404, detail="当前报告没有正在运行的 AI 分析")
        connection.execute(
            """UPDATE report_analysis_runs
               SET status = 'cancelled', error = '用户已取消 AI 分析', completed_at = ?
               WHERE id = ? AND status = 'pending'""",
            (_now(), pending["id"]),
        )
    return {"cancel_requested": True, "stopping": False}


@router.get("/runs")
def get_analysis_history(report_id: int) -> list[dict[str, object]]:
    """运行历史与当前活动结果是两个视图。"""
    with open_database() as connection:
        return analysis_history(connection, report_id)


def _background_failure(report_id: int, message: str) -> None:
    """拒绝准入或后台失败不能留下永久 pending，更不触碰报告事实。"""
    with open_database() as connection:
        connection.execute(
            """UPDATE report_analysis_runs SET status = 'failed', error = ?,
               completed_at = ? WHERE report_id = ? AND status = 'pending'""",
            (message, _now(), report_id),
        )


def run_analysis_in_background(report_id: int) -> None:
    """事实报告先独立提交，后台任务仅在仍需运行时调用 AI。"""
    with open_database() as connection:
        pending = connection.execute(
            "SELECT id FROM report_analysis_runs WHERE report_id = ? AND status = 'pending'",
            (report_id,),
        ).fetchone()
        if pending is None:
            return  # 在获得租约前已被用户取消
        try:
            result = run_analysis(connection, report_id)
            if result.status == "not_enabled":
                _background_failure(report_id, result.message)
        except HTTPException as error:
            _background_failure(report_id, str(error.detail))
        except Exception:
            _background_failure(report_id, "报告 AI 后台分析失败")
