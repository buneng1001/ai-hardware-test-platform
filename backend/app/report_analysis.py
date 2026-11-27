"""事实报告的可选 AI 分析；只消费已保存快照，且不进入报告生成关键路径。"""

import json
import logging
import os
import sqlite3
import time
from collections.abc import Callable
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError

from app.ai_batching import (
    DatabaseCheckpoints,
    batch_config,
    preflight_budget,
    run_fingerprint,
    semantic_batches,
)
from app.ai_checkpoint_resume import resume_source, save_plan
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
from app.report_analysis_batching import run_batches, validate_professional_output
from app.report_analysis_contract import (
    BATCH_PROMPT_VERSION,
    OUTPUT_FIELDS,
    REPAIR_PROMPT_VERSION,
    REPORT_PROMPT_VERSION,
    evidence_payload,
    missing_simulation_analysis,
    normalize_report_output,
    report_system_prompt,
)
from app.report_analysis_inputs import (
    analysis_input as _analysis_input,
)
from app.report_analysis_inputs import (
    build_mock_analysis,
    source_catalog_context,
)
from app.report_analysis_progress import report_progress, set_phase
from app.settings import configured_api_key, current_settings, get_provider_adapter
from app.siliconflow import ModelErrorKind, SiliconFlowError
from app.structured_repair import RepairBudget, run_repair_ladder

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
    analysis = _latest_analysis(connection, report_id)
    return analysis.model_copy(update={"progress": report_progress(connection, report_id)})


def _latest_analysis(connection: sqlite3.Connection, report_id: int) -> ReportAnalysis:
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
    # A previous backend process may have exited mid-request. Recover the
    # visible outcome from the durable batch run, not a stale report status.
    interrupted = connection.execute(
        """SELECT status, created_at FROM ai_batch_runs
           WHERE operation_type = 'report_analysis' AND resource_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT 1""",
        (report_id,),
    ).fetchone()
    if interrupted is not None and interrupted["status"] == "interrupted":
        previous = connection.execute(
            """SELECT * FROM report_analysis_runs WHERE report_id = ? AND is_visible = 1
               ORDER BY (status = 'completed' AND is_active = 1) DESC, id DESC LIMIT 1""",
            (report_id,),
        ).fetchone()
        if previous is None or (
            previous["status"] != "completed" and previous["created_at"] <= interrupted["created_at"]
        ):
            return ReportAnalysis(
                status="failed",
                message="报告 AI 分析意外中断，已保留有效检查点；请主动继续进行或重新运行",
                output=None,
                error={
                    "kind": "interrupted",
                    "stage": "report_analysis",
                    "action": "检查可用检查点后选择继续进行或重新运行",
                },
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
           ORDER BY (status = 'completed' AND is_active = 1) DESC, id DESC LIMIT 1""",
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
    if lease is not None and output is not None:
        set_phase(lease.invocation_id, "saving")
    snapshot = config_snapshot if config_snapshot is not None else selected_snapshot_payload()
    if lease is not None:
        connection.execute("BEGIN IMMEDIATE")
        lease.assert_can_commit(connection)
    fingerprint = run_fingerprint(analysis_input, snapshot, model, REPORT_PROMPT_VERSION)
    # Preserve an effective successful analysis, never a stale failed/cancelled row.
    previous_success = connection.execute(
        """SELECT 1 FROM report_analysis_runs WHERE report_id = ?
           AND status = 'completed' AND is_active = 1 AND is_visible = 1""",
        (report_id,),
    ).fetchone()
    activate = output is not None or previous_success is None
    if activate:
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
            int(activate),
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


def _generate_validated_output(
    *,
    adapter,
    api_key: str,
    model: str,
    data: dict[str, object],
    refs: set[str],
    config,
    lease: AiInvocationLease,
    repair_budget: RepairBudget,
    batch: bool = False,
    progress: Callable[[str], None] | None = None,
) -> ReportAnalysisOutput:
    """首次输出与一次受约束修复使用同一 Schema、同一证据白名单。"""
    payload = evidence_payload(data, refs)
    prompt = report_system_prompt(batch=batch)
    evidence = json.dumps(payload, ensure_ascii=False)
    preflight_budget(prompt + evidence, config)
    if lease.cancel_requested():
        raise AiInvocationCancelled("报告 AI 分析已取消")
    if progress is not None:
        progress("model_request")
    raw = adapter.generate_json(
        api_key=api_key,
        model=model,
        evidence_json=evidence,
        system_prompt=prompt,
        prompt_version=BATCH_PROMPT_VERSION if batch else REPORT_PROMPT_VERSION,
        stage="report_analysis_batch" if batch else "report_analysis",
    )
    if lease.cancel_requested():
        raise AiInvocationCancelled("报告 AI 分析已取消；迟到输出已丢弃")

    def repair(instruction: str) -> str:
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消")
        repair_system = report_system_prompt(batch=batch, repair=True)
        repair_evidence = json.dumps(
            {"repair_instruction": instruction, "report_input": payload, "allowed_evidence_refs": sorted(refs)},
            ensure_ascii=False,
        )
        preflight_budget(repair_system + repair_evidence, config)
        if progress is not None:
            progress("repair")
        fixed = adapter.generate_json(
            api_key=api_key,
            model=model,
            evidence_json=repair_evidence,
            system_prompt=repair_system,
            prompt_version=REPAIR_PROMPT_VERSION,
            stage="report_analysis_repair",
        )
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消；修复输出已丢弃")
        return json.dumps(fixed, ensure_ascii=False)

    repair_budget.remaining_calls = min(
        repair_budget.remaining_calls,
        max(0, getattr(adapter, "max_calls", config.call_limit) - getattr(adapter, "call_count", 1)),
    )
    if progress is not None:
        progress("validation")
    output, _steps = run_repair_ladder(
        raw,
        validate=lambda value: validate_professional_output(value, refs),
        normalize=normalize_report_output,
        repair=repair,
        budget=repair_budget,
        fields=OUTPUT_FIELDS,
        allowed_refs=sorted(refs),
    )
    return output


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
    resumed_from: str | None = None,
) -> ReportAnalysisOutput:
    """多批分析：按模块/记录切批，截断二分，检查点恢复。"""
    adapter.max_calls = config.call_limit
    fingerprint = run_fingerprint(analysis_input, dict(lease.config_snapshot), model, BATCH_PROMPT_VERSION)
    repair_budget = RepairBudget(config.call_limit)

    def call_model(batch: dict[str, object]) -> dict[str, object]:
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消")
        refs = set(batch["refs"])
        return _generate_validated_output(
            adapter=adapter,
            api_key=api_key,
            model=model,
            data=batch,
            refs=refs,
            config=config,
            lease=lease,
            repair_budget=repair_budget,
            batch=True,
            progress=lambda phase: set_phase(lease.invocation_id, phase),
        ).model_dump()

    def ensure_active() -> bool:
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消")
        return False

    return run_batches(
        semantic_batches(analysis_input, config),
        call_model=call_model,
        valid_refs=valid_refs,
        checkpoints=DatabaseCheckpoints(report_id, fingerprint, lease=lease, resumed_from=resumed_from),
        config=config,
        cancel_event=ensure_active,
    )


def _report_analysis_input(connection: sqlite3.Connection, report_id: int) -> tuple[dict[str, object], set[str], int]:
    """仅在启动时读取画像/版本说明，绝不回写事实报告快照。"""
    row = connection.execute(
        """SELECT report.snapshot, report.product_version_id, version.project_id,
                  version.ai_context, project.product_profile
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
    analysis_input["source_catalog"] = source_catalog_context(connection, row["product_version_id"], analysis_input)
    valid_refs.add("source_catalog")
    if profile:
        valid_refs.add("product_profile")
    if analysis_input["version_ai_context"]:
        valid_refs.add("version_ai_context")
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
    resumed_from: str | None = None,
) -> ReportAnalysis:
    config_snapshot = dict(lease.config_snapshot)
    fingerprint = run_fingerprint(analysis_input, config_snapshot, model, REPORT_PROMPT_VERSION)
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
    started = time.monotonic()
    try:
        adapter = get_provider_adapter(provider)
        if hasattr(adapter, "request_log_sink"):
            adapter.request_log_sink = save_request_logs
        if hasattr(adapter, "network_mode"):
            adapter.network_mode = str(config_snapshot.get("network_mode", "auto"))
        config = batch_config()
        adapter.max_calls = config.call_limit
        if hasattr(adapter, "_cancel_event"):
            adapter._cancel_event = lease.cancel_requested
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
                resumed_from=resumed_from,
            )
        else:
            output = _generate_validated_output(
                adapter=adapter,
                api_key=api_key,
                model=model,
                data=analysis_input,
                refs=valid_refs,
                config=config,
                lease=lease,
                repair_budget=RepairBudget(config.call_limit),
                progress=lambda phase: set_phase(lease.invocation_id, phase),
            )
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消")
        set_phase(lease.invocation_id, "aggregate_validation")
        if missing_simulation_analysis(output, analysis_input):
            raise SiliconFlowError(
                ModelErrorKind.INVALID_RESPONSE,
                "模型输出虽符合格式，但未分析纯模拟执行的风险或补充验证需求",
                False,
                stage="report_analysis_quality",
                action="请复核模型的业务分析能力或切换模型后重新分析；无需重新生成事实报告",
                diagnostic="missing_simulation_risk_or_verification",
            )
    except AiInvocationCancelled:
        raise
    except (SiliconFlowError, ValidationError, ValueError, TimeoutError) as error:
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消") from error
        if isinstance(error, TimeoutError):
            failure = SiliconFlowError(
                ModelErrorKind.TIMEOUT,
                "模型调用超时",
                False,
                stage="report_analysis",
                provider=provider,
                model=model,
                diagnostic=type(error).__name__,
                action="检查网络与服务商状态后重试；为避免重复请求，本次不会自动重放",
            )
            detail = failure.to_dict()
            message = "模型服务不可用"
        elif isinstance(error, SiliconFlowError):
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
        elapsed = int((time.monotonic() - started) * 1000)
        detail.update(
            {
                "provider": detail.get("provider") or provider,
                "model": detail.get("model") or model,
                "prompt_version": detail.get("prompt_version")
                or getattr(adapter, "prompt_version", REPORT_PROMPT_VERSION),
                "elapsed_ms": elapsed,
                "attempts": getattr(adapter, "call_count", None),
            }
        )
        return _save(
            connection,
            report_id,
            analysis_input,
            output=None,
            error=message,
            error_detail=detail,
            elapsed_ms=elapsed,
            **save_options,
        )
    except Exception as error:
        if lease.cancel_requested():
            raise AiInvocationCancelled("报告 AI 分析已取消") from error
        elapsed = int((time.monotonic() - started) * 1000)
        detail = SiliconFlowError(
            ModelErrorKind.TEMPORARY_SERVICE,
            "报告分析发生未分类异常，不能确定为模型服务故障",
            False,
            stage="report_analysis",
            provider=provider,
            model=model,
            diagnostic=type(error).__name__,
            action="查看请求日志及分析阶段，确认故障原因后再重试",
        ).to_dict()
        return _save(
            connection,
            report_id,
            analysis_input,
            output=None,
            error="报告分析发生未分类异常，不能确定为模型服务故障",
            error_detail={
                **detail,
                "elapsed_ms": elapsed,
                "prompt_version": getattr(adapter, "prompt_version", REPORT_PROMPT_VERSION),
            },
            elapsed_ms=elapsed,
            **save_options,
        )
    finally:
        if adapter is not None:
            try:
                save_request_logs(getattr(adapter, "request_logs", []))
            except Exception as error:
                logging.getLogger(__name__).warning(
                    "Report request metadata persistence failed: %s", type(error).__name__
                )
    return _save(
        connection,
        report_id,
        analysis_input,
        output=output,
        error=None,
        elapsed_ms=int((time.monotonic() - started) * 1000),
        **save_options,
    )


def _resume_plan() -> dict[str, int]:
    config = batch_config()
    return {
        "modules_per_batch": config.modules_per_batch,
        "records_per_batch": config.records_per_batch,
    }


def _resume_for_config(
    connection: sqlite3.Connection,
    report_id: int,
    analysis_input: dict[str, object],
    proposed: dict[str, object],
    configured_model: str,
    is_mock: bool,
) -> tuple[str, str | None, str]:
    """Use the formal model for new runs; keep compatible legacy checkpoint lineage."""
    model = configured_model if is_mock else str(proposed.get("model") or configured_model)
    canonical = run_fingerprint(analysis_input, proposed, model, BATCH_PROMPT_VERSION)
    legacy = run_fingerprint(analysis_input, proposed, configured_model, BATCH_PROMPT_VERSION)
    config_fingerprint = str(proposed.get("fingerprint", ""))
    latest = connection.execute(
        """SELECT input_fingerprint FROM ai_batch_runs
           WHERE operation_type = 'report_analysis' AND resource_id = ?
             AND config_fingerprint = ? AND input_fingerprint IN (?, ?)
           ORDER BY created_at DESC, rowid DESC LIMIT 1""",
        (report_id, config_fingerprint, canonical, legacy),
    ).fetchone()
    candidate_fingerprint = latest["input_fingerprint"] if latest else canonical
    candidate = resume_source(
        "report_analysis", report_id, candidate_fingerprint, config_fingerprint, expected_plan=_resume_plan()
    )
    return canonical, candidate, candidate_fingerprint


def run_analysis(
    connection: sqlite3.Connection,
    report_id: int,
    *,
    force: bool = False,
    overwrite_previous: bool = False,
    resume_choice: str | None = None,
) -> ReportAnalysis:
    analysis_input, valid_refs, project_id = _report_analysis_input(connection, report_id)
    configuration = _configuration()
    if configuration is None:
        return _not_enabled()
    provider, model, api_key, is_mock = configuration
    proposed = selected_snapshot_payload()
    model_fingerprint, eligible, resume_fingerprint = _resume_for_config(
        connection, report_id, analysis_input, proposed, model, is_mock
    )
    if eligible and resume_choice not in ("continue", "restart"):
        raise HTTPException(status_code=409, detail="存在有效检查点，请选择继续进行、重新运行或取消")
    if resume_choice not in (None, "continue", "restart"):
        raise HTTPException(status_code=422, detail="续做选项无效")
    if resume_choice == "continue" and not eligible:
        raise HTTPException(status_code=409, detail="没有有效检查点，请从头重试")
    resumed_from = eligible if resume_choice == "continue" else None
    lease = begin_invocation(
        operation_type="report_analysis",
        project_id=project_id,
        resource_id=report_id,
        execution_mode="checkpointed_batch",
        input_fingerprint=resume_fingerprint if resumed_from else model_fingerprint,
        resumed_from_invocation_id=resumed_from,
    )
    config_snapshot = dict(lease.config_snapshot)
    if not is_mock:
        provider = str(config_snapshot["provider"])
        model = str(config_snapshot["model"])
        api_key = configured_api_key(provider)
    outcome = "failed"
    try:
        plan: dict[str, object] = dict(_resume_plan())
        if not is_mock:
            plan["report_batch_keys"] = [batch["key"] for batch in semantic_batches(analysis_input, batch_config())]
        save_plan(lease.invocation_id, {**plan, "phase": "preparing"})
        result = _perform_analysis(
            connection,
            report_id,
            force=force or resume_choice is not None,
            overwrite_previous=overwrite_previous,
            lease=lease,
            analysis_input=analysis_input,
            valid_refs=valid_refs,
            provider=provider,
            model=model,
            api_key=api_key,
            is_mock=is_mock,
            resumed_from=resumed_from,
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
                "same_input": False,
                "has_previous": False,
                "running_same_operation": False,
                "occupied_other": False,
            }
        _, model, _, is_mock = configuration
        proposed = selected_snapshot_payload()
        formal_model = model if is_mock else str(proposed.get("model") or model)
        fingerprint = run_fingerprint(analysis_input, proposed, formal_model, REPORT_PROMPT_VERSION)
        previous = connection.execute(
            "SELECT 1 FROM report_analysis_runs WHERE report_id = ? AND status = 'completed' AND is_visible = 1",
            (report_id,),
        ).fetchone()
        active = get_active_invocation().active
        _, candidate, _ = _resume_for_config(connection, report_id, analysis_input, proposed, model, is_mock)
        return {
            **({"resume_available": True} if candidate else {}),
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
def retry_report_analysis(
    report_id: int, force: bool = False, overwrite_previous: bool = False, resume_choice: str | None = None
) -> ReportAnalysis:
    with open_database() as connection:
        return run_analysis(
            connection, report_id, force=force, overwrite_previous=overwrite_previous, resume_choice=resume_choice
        )


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
