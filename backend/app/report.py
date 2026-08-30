import html
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app.artifact_io import read_fault_truth
from app.database import get_data_dir
from app.diagnosis import latest_diagnosis
from app.run_models import (
    Artifact,
    BasicCheck,
    DiagnosisRun,
    EvaluationResult,
    ManualCheckResult,
    RunConfigurationSnapshot,
    RunRecord,
    StageEvent,
    TimeAlignmentResult,
)
from app.runs import _get_run

router = APIRouter(tags=["reports"])


type JsonValue = dict[str, object] | list[object] | str | int | float | bool | None


class DiagnosisNotGenerated(BaseModel):
    status: str
    message: str


class ReportDocument(BaseModel):
    run_id: int
    status: str
    error: str | None
    configuration_snapshot: RunConfigurationSnapshot
    stage_events: list[StageEvent]
    generation_metadata: JsonValue
    artifacts: list[Artifact]
    automated_checks: list[BasicCheck]
    fault_truth: JsonValue
    alignment_result: TimeAlignmentResult | None
    evaluation_result: EvaluationResult | None
    manual_check_results: list[ManualCheckResult]
    diagnosis: DiagnosisRun | DiagnosisNotGenerated
    created_at: str
    completed_at: str | None


def _read_fault_truth(run: RunRecord) -> JsonValue:
    """读取已生成的真值内容，让独立报告也能审查故障注入事实。"""
    try:
        return read_fault_truth(run.artifacts, get_data_dir())
    except (OSError, StopIteration, json.JSONDecodeError):
        return None


def _report_document(run: RunRecord) -> ReportDocument:
    """把运行记录投影成报告文档，保持事实区块彼此独立。"""
    data = run.model_dump(mode="json")
    diagnosis = latest_diagnosis(run.id)
    return ReportDocument(
        run_id=run.id,
        status=run.status,
        error=run.error,
        configuration_snapshot=run.configuration_snapshot,
        stage_events=run.events,
        generation_metadata=data["generation_metadata"],
        artifacts=run.artifacts,
        automated_checks=run.checks,
        fault_truth=_read_fault_truth(run) or None,
        alignment_result=run.alignment_result,
        evaluation_result=run.evaluation_result,
        manual_check_results=run.manual_check_results,
        diagnosis=diagnosis.model_dump(mode="json")
        if diagnosis
        else {"status": "not_generated", "message": "诊断尚未生成"},
        created_at=data["created_at"],
        completed_at=data["completed_at"],
    )


def _get_report(run_id: int) -> ReportDocument:
    run = _get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    return _report_document(run).model_dump(mode="json")


def _json_block(value: object) -> str:
    return html.escape(json.dumps(value, ensure_ascii=False, indent=2))


def _render_html(report: ReportDocument) -> str:
    """生成不依赖应用、数据库或外部资源的独立 HTML。"""
    report_data = report.model_dump(mode="json")
    run_id = html.escape(str(report.run_id))
    status = html.escape(report.status)
    alignment_rows = (
        "".join(
            f"<tr><td>{html.escape(channel)}</td><td>"
            f"{(report.alignment_result.pre_alignment.get(channel, {}).get('offset_s', '—'))}</td>"
            f"<td>{metrics.get('max_residual_ms', '—')}</td><td>{metrics.get('mean_residual_ms', '—')}</td>"
            f"<td>{metrics.get('p95_residual_ms', '—')}</td></tr>"
            for channel, metrics in (report.alignment_result.post_alignment.items() if report.alignment_result else [])
        )
        or "<tr><td colspan='5'>未生成时间对齐结果</td></tr>"
    )
    evaluation = report.evaluation_result
    distribution = evaluation.distribution if evaluation else {}
    passed = int(distribution.get("passed", 0))
    failed = int(distribution.get("failed", 0))
    total = max(passed + failed, 1)
    evaluation_summary = (
        f"<p>模式：{html.escape(evaluation.mode)}；阈值来源：{html.escape(evaluation.threshold_source)}；"
        f"结论：{html.escape(evaluation.conclusion)}；产品承诺：{evaluation.is_product_commitment}</p>"
        f"<div>检查分布：通过 {passed} 项，失败 {failed} 项</div>"
        f"<div style='background:#eee;height:1.2rem;margin:.4rem 0'>"
        f"<span style='display:inline-block;background:#4a8;width:{passed / total * 100:.1f}%;height:100%'></span>"
        f"<span style='display:inline-block;background:#c66;"
        f"width:{failed / total * 100:.1f}%;height:100%'></span></div>"
        if evaluation
        else "<p>未生成判定结果</p>"
    )
    check_rows = "".join(
        f"<tr><td>{html.escape(check.name)}</td>"
        f"<td>{html.escape(check.category)}</td>"
        f"<td>{html.escape(check.status)}</td>"
        f"<td>{html.escape(check.truth_comparison)}</td>"
        f"<td>{html.escape(check.message)}</td>"
        f"<td>{html.escape(json.dumps(check.anomaly_windows, ensure_ascii=False))}</td></tr>"
        for check in report.automated_checks
    )
    manual_rows = (
        "".join(
            f"<tr><td>{html.escape(result.name)}</td>"
            f"<td>{html.escape(result.status)}</td>"
            f"<td>{html.escape(result.actual_result or '')}</td>"
            f"<td>{html.escape(result.notes or '')}</td></tr>"
            for result in report.manual_check_results
        )
        or "<tr><td colspan='4'>暂无人工检查结果</td></tr>"
    )
    return f"""<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>运行 #{run_id} 分析报告</title>
<style>body{{font-family:system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;line-height:1.5}}
table{{border-collapse:collapse;width:100%;margin:1rem 0}}th,td{{border:1px solid #bbb;padding:.45rem;text-align:left}}
pre{{white-space:pre-wrap;background:#f5f5f5;padding:1rem;overflow:auto}}.status{{font-weight:700}}</style>
</head><body><h1>运行 #{run_id} 分析报告</h1><p class="status">状态：{status}</p>
<h2>配置快照</h2><pre>{_json_block(report_data["configuration_snapshot"])}</pre>
<h2>运行阶段</h2><pre>{_json_block(report_data["stage_events"])}</pre>
<h2>产物与来源</h2><pre>{_json_block(report_data["artifacts"])}</pre>
<h2>故障真值</h2><pre>{_json_block(report.fault_truth or "未找到故障真值内容")}</pre>
<h2>自动化检测结果与故障真值对照</h2>
<table><thead><tr><th>检查项</th><th>类别</th><th>状态</th><th>真值对照</th><th>说明</th><th>异常窗口</th></tr></thead>
<tbody>{check_rows}</tbody></table>
<h2>时间分析</h2><table><thead><tr><th>通道</th><th>对齐前偏移(s)</th>
<th>对齐后最大(ms)</th><th>对齐后平均(ms)</th><th>对齐后 P95(ms)</th></tr></thead>
<tbody>{alignment_rows}</tbody></table><pre>{_json_block(report_data["alignment_result"] or "未生成时间对齐结果")}</pre>
<h2>判定依据</h2>{evaluation_summary}<pre>{_json_block(report_data["evaluation_result"] or "未生成判定结果")}</pre>
<h2>人工检查结果</h2><table><thead><tr><th>检查项</th><th>状态</th><th>实际结果</th><th>备注</th></tr></thead>
<tbody>{manual_rows}</tbody></table>
<h2>诊断状态</h2><pre>{_json_block(report_data["diagnosis"])}</pre>
<h2>原始报告数据</h2><pre>{_json_block(report_data)}</pre>
</body></html>"""


@router.get("/api/runs/{run_id}/report", response_model=ReportDocument)
def get_report(run_id: int) -> ReportDocument:
    return _get_report(run_id)


@router.get("/api/runs/{run_id}/report.html", response_class=HTMLResponse)
def get_html_report(run_id: int) -> HTMLResponse:
    run = _get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    return HTMLResponse(_render_html(_report_document(run)))
