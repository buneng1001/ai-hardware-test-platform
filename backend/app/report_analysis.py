"""事实报告的可选 AI 分析；只消费已保存快照，且不进入报告生成关键路径。"""

import json
import os
import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError

from app.database import open_database
from app.fact_report_models import ReportAnalysis, ReportAnalysisItem, ReportAnalysisOutput, ReportStageRecommendation
from app.settings import configured_api_key, current_settings, get_provider_adapter
from app.siliconflow import SiliconFlowError

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
    if row["status"] == "pending":
        return ReportAnalysis(status="pending", message="AI 分析正在运行", output=None)
    if row["status"] == "completed":
        return ReportAnalysis(
            status="completed", message="AI 分析已完成", output=ReportAnalysisOutput.model_validate_json(row["output"])
        )
    return ReportAnalysis(status=row["status"], message=f"分析未完成：{row['error']}", output=None)


def latest_analysis(connection: sqlite3.Connection, report_id: int) -> ReportAnalysis:
    row = connection.execute(
        "SELECT * FROM report_analysis_runs WHERE report_id = ? ORDER BY id DESC LIMIT 1", (report_id,)
    ).fetchone()
    return _from_row(row) if row else _not_enabled()


def enqueue_analysis(connection: sqlite3.Connection, report_id: int) -> None:
    configuration = _configuration()
    if configuration is None:
        return
    provider, model, _, is_mock = configuration
    connection.execute(
        """INSERT INTO report_analysis_runs
           (report_id, status, provider, model, is_mock, input_snapshot, output, error, created_at, completed_at)
           VALUES (?, 'pending', ?, ?, ?, '{}', NULL, NULL, ?, ?)""",
        (report_id, provider, model, int(is_mock), _now(), _now()),
    )


def _analysis_input(snapshot: dict[str, object]) -> tuple[dict[str, object], set[str]]:
    """只选择持久化事实报告内的有限字段，避免把日志或可变资产交给模型。"""
    modules = []
    refs = {"stage_progress"}
    for module_index, module in enumerate(snapshot["modules"]):
        module_ref = f"module:{module_index}"
        refs.add(module_ref)
        records = []
        for record_index, record in enumerate(module["records"]):
            record_ref = f"record:{module_index}:{record_index}"
            refs.add(record_ref)
            records.append(
                {
                    "ref": record_ref,
                    "case_number": record["case_number"],
                    "title": record["title"],
                    "source": record["source"],
                    "status": record["status"],
                    "message": record["message"],
                }
            )
        modules.append(
            {
                "ref": module_ref,
                "name": module["name"],
                "conclusion": module["conclusion"],
                "counts": module["counts"],
                "records": records,
            }
        )
    issues = []
    for index, issue in enumerate(snapshot["cross_module_issues"]):
        ref = f"cross_issue:{index}"
        refs.add(ref)
        issues.append({"ref": ref, **issue})
    return {
        "stage_progress": snapshot["stage_progress"],
        "scope_overview": snapshot["scope_overview"],
        "modules": modules,
        "cross_module_issues": issues,
    }, refs


def _item(content: str, evidence_ref: str) -> ReportAnalysisItem:
    return ReportAnalysisItem(content=content, evidence_refs=[evidence_ref])


def build_mock_analysis(analysis_input: dict[str, object]) -> ReportAnalysisOutput:
    """离线演示使用固定结构化输出，避免 Mock 随输入产生不可复现结论。"""
    return ReportAnalysisOutput(
        risks=[_item("请优先人工复核已保存报告中的失败、阻塞和结果不一致项。", "stage_progress")],
        additional_verifications=[_item("请依据现有事实记录补充验证，不新增未记录的阈值。", "stage_progress")],
        regression_recommendations=[_item("请从已保存报告范围内选择后续回归项。", "stage_progress")],
        stage_recommendation=ReportStageRecommendation(
            suggestion="请依据已保存事实报告补充验证后，再决定是否推进阶段。",
            content="阶段建议仅作为参考，不构成强制质量门禁。",
            evidence_refs=["stage_progress"],
        ),
    )


def _validate_output(raw_output: dict[str, object], valid_refs: set[str]) -> ReportAnalysisOutput:
    output = ReportAnalysisOutput.model_validate(raw_output)
    items = [
        *output.risks,
        *output.additional_verifications,
        *output.regression_recommendations,
        output.stage_recommendation,
    ]
    invalid_refs = sorted({ref for item in items for ref in item.evidence_refs if ref not in valid_refs})
    if invalid_refs:
        raise ValueError(f"包含无效事实引用：{', '.join(invalid_refs)}")
    return output


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
) -> ReportAnalysis:
    connection.execute(
        """INSERT INTO report_analysis_runs
           (report_id, status, provider, model, is_mock, input_snapshot, output, error, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
        ),
    )
    return latest_analysis(connection, report_id)


def run_analysis(connection: sqlite3.Connection, report_id: int) -> ReportAnalysis:
    row = connection.execute("SELECT snapshot FROM online_reports WHERE id = ?", (report_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="事实报告不存在")
    configuration = _configuration()
    if configuration is None:
        return _not_enabled()
    analysis_input, valid_refs = _analysis_input(json.loads(row["snapshot"]))
    provider, model, api_key, is_mock = configuration
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
    try:
        raw_output = get_provider_adapter(provider).generate_json(
            api_key=api_key,
            model=model,
            evidence_json=json.dumps(analysis_input, ensure_ascii=False),
            system_prompt=(
                "只返回报告分析 JSON：risks、additional_verifications、regression_recommendations 和 "
                "stage_recommendation。"
                "每项都必须附现有 evidence_refs；只能给建议，不能补充阈值、修改事实或实施质量门禁。"
            ),
        )
        output = _validate_output(raw_output, valid_refs)
    except (SiliconFlowError, ValidationError, ValueError) as error:
        return _save(
            connection,
            report_id,
            analysis_input,
            provider=provider,
            model=model,
            is_mock=False,
            output=None,
            error="模型分析结构无效" if isinstance(error, ValidationError | ValueError) else str(error),
        )
    except Exception:
        return _save(
            connection,
            report_id,
            analysis_input,
            provider=provider,
            model=model,
            is_mock=False,
            output=None,
            error="模型服务不可用",
        )
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
def retry_report_analysis(report_id: int) -> ReportAnalysis:
    with open_database() as connection:
        return run_analysis(connection, report_id)


def run_analysis_in_background(report_id: int) -> None:
    """报告已提交后才开始 AI 调用，模型故障不能影响事实报告接口。"""
    with open_database() as connection:
        run_analysis(connection, report_id)
