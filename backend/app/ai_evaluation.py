"""AI 诊断效果评估和仪表盘的只读聚合。"""

import re
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.artifact_io import read_fault_truth
from app.database import get_data_dir, open_database
from app.diagnosis import latest_diagnosis
from app.run_models import AiEvaluationResult, DiagnosisRun, RunRecord
from app.runs import _get_run

router = APIRouter(tags=["dashboard"])

FAULT_ALIASES = {
    "video_frame_drop": ("video_frame_drop", "视频", "掉帧"),
    "imu_missing_sample": ("imu_missing_sample", "imu_missing_samples", "丢样"),
    "imu_duplicate_sample": ("imu_duplicate_sample", "imu_duplicate_samples", "重复样本"),
    "imu_timestamp_rollback": ("imu_timestamp_rollback", "倒退", "回退"),
    "storage_exhaustion": ("storage_exhaustion", "存储", "提前停止"),
    "temperature_rise": ("temperature_rise", "温升", "温度"),
}
NEGATED_FAULT_PATTERN = re.compile(r"(?:未发现|未检测到|没有|无|不含)[^。；，,]{0,8}$")


def _fault_truth(run: RunRecord) -> dict:
    return read_fault_truth(run.artifacts, get_data_dir())


def _cause_fault_types(diagnosis: DiagnosisRun) -> list[str]:
    if diagnosis.output is None:
        return []
    types: list[str] = []
    for cause in diagnosis.output.possible_causes:
        if cause.is_speculation or not cause.evidence_refs:
            continue
        text = cause.cause.casefold()
        for fault_type, aliases in FAULT_ALIASES.items():
            if any(
                alias.casefold() in text
                and not NEGATED_FAULT_PATTERN.search(text[: text.find(alias.casefold())])
                for alias in aliases
            ) and fault_type not in types:
                types.append(fault_type)
    return types


def evaluate_diagnosis(run: RunRecord, diagnosis: DiagnosisRun) -> AiEvaluationResult:
    """用生成时保存的真值评价诊断，不把检查器结果当作 AI 正确率。"""
    truth = _fault_truth(run)
    expected = [fault["type"] for fault in truth.get("faults", [])]
    if diagnosis.status != "completed" or diagnosis.output is None:
        return AiEvaluationResult(
            status="not_evaluated",
            structure_valid=False,
            scenario=run.configuration_snapshot.scenario,
            expected_fault_types=expected,
            diagnosed_fault_types=[],
            hit_fault_types=[],
            missed_fault_types=expected,
            hit_count=0,
            missed_count=len(expected),
            unsupported_speculation_count=0,
            false_positive_count=0,
            reason=diagnosis.error or "诊断没有结构化输出",
            summary="诊断未完成，暂不计算效果指标。",
        )

    diagnosed = _cause_fault_types(diagnosis)
    expected_set = set(expected)
    diagnosed_set = set(diagnosed)
    hits = [fault_type for fault_type in expected if fault_type in diagnosed_set]
    missed = [fault_type for fault_type in expected if fault_type not in diagnosed_set]
    unsupported = sum(
        cause.is_speculation and not cause.evidence_refs
        for cause in diagnosis.output.possible_causes
    )
    false_positive_count = len(diagnosed_set - expected_set)
    return AiEvaluationResult(
        status="evaluated",
        structure_valid=True,
        scenario=run.configuration_snapshot.scenario,
        expected_fault_types=expected,
        diagnosed_fault_types=diagnosed,
        hit_fault_types=hits,
        missed_fault_types=missed,
        hit_count=len(hits),
        missed_count=len(missed),
        unsupported_speculation_count=unsupported,
        false_positive_count=false_positive_count,
        summary=(
            f"命中 {len(hits)} 项，漏判 {len(missed)} 项，无证据推测 {unsupported} 项；Schema 有效不等于诊断正确。"
        ),
    )


class RunStatistics(BaseModel):
    total: int
    completed: int
    failed: int
    cancelled: int
    interrupted: int


class RecentFailure(BaseModel):
    run_id: int
    scenario: str
    status: str
    error: str | None
    failed_check_count: int
    latest_diagnosis_status: str | None


class EvaluationSummary(BaseModel):
    evaluated_runs: int
    hit_count: int
    missed_count: int
    unsupported_speculation_count: int
    false_positive_count: int


class DashboardResponse(BaseModel):
    generated_at: datetime
    run_statistics: RunStatistics
    recent_failures: list[RecentFailure]
    diagnosis_status_counts: dict[str, int]
    evaluation_summary: EvaluationSummary


@router.get("/api/runs/{run_id}/ai-evaluation", response_model=AiEvaluationResult)
def get_ai_evaluation(run_id: int) -> AiEvaluationResult:
    run = _get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    diagnosis = latest_diagnosis(run_id)
    if diagnosis is None:
        raise HTTPException(status_code=404, detail="诊断尚未生成")
    return diagnosis.evaluation or evaluate_diagnosis(run, diagnosis)


@router.get("/api/dashboard", response_model=DashboardResponse)
def get_dashboard() -> DashboardResponse:
    with open_database() as connection:
        run_rows = connection.execute("SELECT * FROM runs ORDER BY id DESC").fetchall()
        diagnosis_rows = connection.execute("SELECT * FROM diagnosis_runs ORDER BY id DESC").fetchall()

    runs = [_get_run(row["id"]) for row in run_rows]
    records = [run for run in runs if run is not None]
    diagnosis_by_run: dict[int, list[DiagnosisRun]] = {}
    for row in diagnosis_rows:
        from app.diagnosis import _diagnosis_from_row

        diagnosis_by_run.setdefault(row["run_id"], []).append(_diagnosis_from_row(row))

    status_counts = {status: 0 for status in ("pending", "generating", "completed", "failed")}
    evaluations: list[AiEvaluationResult] = []
    for diagnosis in [item for items in diagnosis_by_run.values() for item in items]:
        status_counts[diagnosis.status] = status_counts.get(diagnosis.status, 0) + 1
        if diagnosis.evaluation and diagnosis.evaluation.status == "evaluated":
            evaluations.append(diagnosis.evaluation)

    recent_failures = []
    for run in records:
        failed_checks = sum(check.status == "failed" for check in run.checks)
        if run.status == "failed" or failed_checks:
            diagnoses = diagnosis_by_run.get(run.id, [])
            recent_failures.append(
                RecentFailure(
                    run_id=run.id,
                    scenario=run.configuration_snapshot.scenario,
                    status=run.status,
                    error=run.error,
                    failed_check_count=failed_checks,
                    latest_diagnosis_status=diagnoses[-1].status if diagnoses else None,
                )
            )
        if len(recent_failures) == 5:
            break

    return DashboardResponse(
        generated_at=datetime.now(UTC),
        run_statistics=RunStatistics(
            total=len(records),
            completed=sum(run.status == "completed" for run in records),
            failed=sum(run.status == "failed" for run in records),
            cancelled=sum(run.status == "cancelled" for run in records),
            interrupted=sum(run.status == "interrupted" for run in records),
        ),
        recent_failures=recent_failures,
        diagnosis_status_counts=status_counts,
        evaluation_summary=EvaluationSummary(
            evaluated_runs=len(evaluations),
            hit_count=sum(item.hit_count for item in evaluations),
            missed_count=sum(item.missed_count for item in evaluations),
            unsupported_speculation_count=sum(item.unsupported_speculation_count for item in evaluations),
            false_positive_count=sum(item.false_positive_count for item in evaluations),
        ),
    )
