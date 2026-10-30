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
from app.database import open_database
from app.fact_report_models import ReportAnalysis, ReportAnalysisOutput
from app.report_analysis_batching import (
    cancel_requested,
    request_cancel,
    run_batches,
    validate_report_output,
)
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
    mode = os.getenv("REPORT_ANALYSIS_MODE", "disabled")
    if mode == "mock":
        return "mock", "mock-report-analysis-v1", "", True
    if mode != "configured":
        return None
    settings = current_settings()
    if settings.mode == "mock":
        return None
    return settings.provider, settings.model, configured_api_key(settings.provider), False


def analysis_is_enabled() -> bool:
    return _configuration() is not None


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
    row = connection.execute(
        """SELECT * FROM report_analysis_runs WHERE report_id = ?
           ORDER BY is_active DESC, id DESC LIMIT 1""",
        (report_id,),
    ).fetchone()
    return _from_row(row) if row else _not_enabled()


def find_reusable_analysis(connection: sqlite3.Connection, report_id: int, fingerprint: str) -> sqlite3.Row | None:
    """相同指纹已有成功结果时才允许复用；失败运行不参与。"""
    return connection.execute(
        """SELECT * FROM report_analysis_runs
           WHERE report_id = ? AND fingerprint = ? AND status = 'completed'
           ORDER BY id DESC LIMIT 1""",
        (report_id, fingerprint),
    ).fetchone()


def analysis_history(connection: sqlite3.Connection, report_id: int) -> list[dict[str, object]]:
    """历史运行与当前活动视图分开；按时间倒序返回摘要。"""
    rows = connection.execute(
        """SELECT id, status, fingerprint, stage, elapsed_ms, is_active, created_at
           FROM report_analysis_runs WHERE report_id = ? ORDER BY id DESC""",
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
) -> ReportAnalysis:
    snapshot = selected_snapshot_payload()
    fingerprint = run_fingerprint(analysis_input, snapshot, model, "report-analysis-v1")
    connection.execute(
        "UPDATE report_analysis_runs SET is_active = 0 WHERE report_id = ?",
        (report_id,),
    )
    connection.execute(
        """INSERT INTO report_analysis_runs
           (report_id, status, provider, model, is_mock, input_snapshot, output, error,
            created_at, completed_at, config_snapshot, error_detail, fingerprint,
            stage, elapsed_ms, reused_from_id, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
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
        ),
    )
    return latest_analysis(connection, report_id)


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
) -> ReportAnalysisOutput:
    """多批分析：按模块/记录切批，截断二分，检查点恢复。"""
    adapter.max_calls = config.call_limit
    fingerprint = input_fingerprint(analysis_input, provider, model)

    def call_model(batch: dict[str, object]) -> dict[str, object]:
        return adapter.generate_json(
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

    return run_batches(
        semantic_batches(analysis_input, config),
        call_model=call_model,
        valid_refs=valid_refs,
        checkpoints=DatabaseCheckpoints(report_id, fingerprint),
        config=config,
        cancel_event=lambda: cancel_requested(report_id),
    )


def run_analysis(connection: sqlite3.Connection, report_id: int, *, force: bool = False) -> ReportAnalysis:
    row = connection.execute("SELECT snapshot FROM online_reports WHERE id = ?", (report_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="事实报告不存在")
    configuration = _configuration()
    if configuration is None:
        return _not_enabled()
    analysis_input, valid_refs = _analysis_input(json.loads(row["snapshot"]))
    provider, model, api_key, is_mock = configuration
    config_snapshot = selected_snapshot_payload()
    fingerprint = run_fingerprint(analysis_input, config_snapshot, model, "report-analysis-v1")
    if not force:
        reusable = find_reusable_analysis(connection, report_id, fingerprint)
        if reusable is not None:
            reused = _from_row(reusable)
            return reused.model_copy(
                update={
                    "reused": True,
                    "message": f"复用运行 #{reusable['id']}，未重复调用模型",
                }
            )
    if is_mock:
        return _save(
            connection,
            report_id,
            analysis_input,
            provider=provider,
            model=model,
            is_mock=True,
            output=build_mock_analysis(analysis_input),
            error=None,
        )
    adapter = get_provider_adapter(provider)
    if hasattr(adapter, "network_mode"):
        adapter.network_mode = str(config_snapshot.get("network_mode", "auto"))
    config = batch_config()
    adapter.max_calls = config.call_limit
    batches = semantic_batches(analysis_input, config)
    if len(batches) > 1:
        try:
            batched_output = _run_batched_analysis(
                report_id=report_id,
                analysis_input=analysis_input,
                valid_refs=valid_refs,
                provider=provider,
                model=model,
                api_key=api_key,
                adapter=adapter,
                config=config,
            )
        except (SiliconFlowError, ValidationError, ValueError) as error:
            detail = (
                error.to_dict()
                if isinstance(error, SiliconFlowError)
                else SiliconFlowError(
                    ModelErrorKind.SCHEMA_VALIDATION,
                    "模型分析结构无效",
                    False,
                    stage="report_analysis",
                    provider=provider,
                    model=model,
                ).to_dict()
            )
            save_request_logs(getattr(adapter, "request_logs", []))
            return _save(
                connection,
                report_id,
                analysis_input,
                provider=provider,
                model=model,
                is_mock=False,
                output=None,
                error=("模型分析结构无效" if detail.get("kind") == ModelErrorKind.SCHEMA_VALIDATION else str(error)),
                error_detail=detail,
            )
        save_request_logs(getattr(adapter, "request_logs", []))
        return _save(
            connection,
            report_id,
            analysis_input,
            provider=provider,
            model=model,
            is_mock=False,
            output=batched_output,
            error=None,
        )
    preflight_budget(json.dumps(analysis_input, ensure_ascii=False), config)
    try:
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

        def repair(prompt: str) -> str:
            repaired = adapter.generate_json(
                api_key=api_key,
                model=model,
                evidence_json=json.dumps(
                    {
                        "repair_instruction": prompt,
                        "report_input": analysis_input,
                    },
                    ensure_ascii=False,
                ),
                system_prompt=("按修复指令只返回报告分析 JSON；不得新增、删除或改写业务事实。"),
                prompt_version="report-analysis-repair-v1",
                stage="report_analysis_repair",
            )
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
        save_request_logs(getattr(adapter, "request_logs", []))
        return _save(
            connection,
            report_id,
            analysis_input,
            provider=provider,
            model=model,
            is_mock=False,
            output=None,
            error=message,
            error_detail=detail,
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
        save_request_logs(getattr(adapter, "request_logs", []))
        return _save(
            connection,
            report_id,
            analysis_input,
            provider=provider,
            model=model,
            is_mock=False,
            output=None,
            error="模型服务不可用",
            error_detail=detail,
        )
    save_request_logs(getattr(adapter, "request_logs", []))
    return _save(
        connection,
        report_id,
        analysis_input,
        provider=provider,
        model=model,
        is_mock=False,
        output=output,
        error=None,
    )


@router.post("", response_model=ReportAnalysis, status_code=status.HTTP_201_CREATED)
def retry_report_analysis(report_id: int, force: bool = False) -> ReportAnalysis:
    with open_database() as connection:
        return run_analysis(connection, report_id, force=force)


@router.post("/cancel")
def cancel_report_analysis(report_id: int) -> dict[str, bool]:
    """在下一批次边界取消；已完成批次检查点保留。"""
    request_cancel(report_id)
    return {"cancel_requested": True}


@router.get("/runs")
def get_analysis_history(report_id: int) -> list[dict[str, object]]:
    """运行历史与当前活动结果是两个视图。"""
    with open_database() as connection:
        return analysis_history(connection, report_id)


def run_analysis_in_background(report_id: int) -> None:
    """报告已提交后才开始 AI 调用，模型故障不能影响事实报告接口。"""
    with open_database() as connection:
        run_analysis(connection, report_id)
