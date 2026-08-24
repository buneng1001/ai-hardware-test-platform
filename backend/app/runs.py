import json
import sqlite3
import subprocess
from collections.abc import Callable
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status

from app.database import get_data_dir, open_database
from app.evaluation import evaluate_run
from app.imu_checks import run_imu_checks
from app.manual_check_results import list_manual_results
from app.normal_generator import generate_normal_artifacts
from app.resource_checks import run_resource_checks
from app.run_models import AlignmentReviewCommand, RunConfigurationSnapshot, RunRecord, StageEvent
from app.storage_checks import run_storage_checks
from app.time_alignment import align_fixed_offset, align_linear_drift
from app.video_checks import run_video_checks

router = APIRouter(tags=["runs"])

TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}


def _now() -> datetime:
    return datetime.now(UTC)


def _event(stage: str) -> StageEvent:
    return StageEvent(stage=stage, occurred_at=_now())


def _record_from_row(row: sqlite3.Row) -> RunRecord:
    alignment_raw = json.loads(row["alignment_result"])
    return RunRecord(
        id=row["id"],
        collection_task_id=row["collection_task_id"],
        status=row["status"],
        configuration_snapshot=json.loads(row["configuration_snapshot"]),
        events=json.loads(row["events"]),
        artifacts=json.loads(row["artifacts"]),
        checks=json.loads(row["checks"]),
        alignment_result=alignment_raw if alignment_raw else None,
        evaluation_result=json.loads(row["evaluation_result"]) or None,
        manual_check_results=list_manual_results(row["id"]),
        generation_metadata=json.loads(row["generation_metadata"]) or None,
        created_at=row["created_at"],
        completed_at=row["completed_at"],
        error=row["error"],
    )


def _get_run(run_id: int) -> RunRecord | None:
    with open_database() as connection:
        row = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    return _record_from_row(row) if row else None


def _save_active_run(record: RunRecord) -> bool:
    """只更新非终态记录，避免工作线程覆盖并发取消结果。"""
    with open_database() as connection:
        cursor = connection.execute(
            """
            UPDATE runs
            SET status = ?, events = ?, artifacts = ?, checks = ?, generation_metadata = ?,
                alignment_result = ?, evaluation_result = ?, completed_at = ?, error = ?
            WHERE id = ? AND status IN ('queued', 'generating_data', 'running_checks', 'summarizing_results')
            """,
            (
                record.status,
                json.dumps([event.model_dump(mode="json") for event in record.events]),
                json.dumps([artifact.model_dump(mode="json") for artifact in record.artifacts]),
                json.dumps([check.model_dump(mode="json") for check in record.checks]),
                record.generation_metadata.model_dump_json() if record.generation_metadata else "{}",
                record.alignment_result.model_dump_json() if record.alignment_result else "{}",
                record.evaluation_result.model_dump_json() if record.evaluation_result else "{}",
                record.completed_at.isoformat() if record.completed_at else None,
                record.error,
                record.id,
            ),
        )
    return cursor.rowcount == 1


def _save_cancelled_evidence(record: RunRecord) -> None:
    """取消不删除已经生成的证据，只阻止后续阶段继续执行。"""
    with open_database() as connection:
        connection.execute(
            """
            UPDATE runs
            SET artifacts = ?, checks = ?, generation_metadata = ?, alignment_result = ?, evaluation_result = ?
            WHERE id = ? AND status = 'cancelled'
            """,
            (
                json.dumps([artifact.model_dump(mode="json") for artifact in record.artifacts]),
                json.dumps([check.model_dump(mode="json") for check in record.checks]),
                record.generation_metadata.model_dump_json() if record.generation_metadata else "{}",
                record.alignment_result.model_dump_json() if record.alignment_result else "{}",
                record.evaluation_result.model_dump_json() if record.evaluation_result else "{}",
                record.id,
            ),
        )


def _create_run(collection_task_id: int, snapshot: RunConfigurationSnapshot) -> RunRecord:
    created_at = _now()
    events = [_event("queued")]
    with open_database() as connection:
        cursor = connection.execute(
            """
            INSERT INTO runs (
                collection_task_id, status, configuration_snapshot, events, artifacts, checks, created_at
            ) VALUES (?, 'queued', ?, ?, '[]', '[]', ?)
            """,
            (
                collection_task_id,
                snapshot.model_dump_json(),
                json.dumps([event.model_dump(mode="json") for event in events]),
                created_at.isoformat(),
            ),
        )
        run_id = cursor.lastrowid
    if run_id is None:
        raise HTTPException(status_code=500, detail="运行记录创建失败")
    return RunRecord(
        id=run_id,
        collection_task_id=collection_task_id,
        status="queued",
        configuration_snapshot=snapshot,
        events=events,
        artifacts=[],
        generation_metadata=None,
        checks=[],
        alignment_result=None,
        evaluation_result=None,
        manual_check_results=[],
        created_at=created_at,
        completed_at=None,
        error=None,
    )


def _stop_requested(record: RunRecord, application_stopping: Callable[[], bool]) -> bool:
    if application_stopping():
        return True
    current = _get_run(record.id)
    if current and current.status == "cancelled":
        _save_cancelled_evidence(record)
        return True
    return False


def process_run(run_id: int, application_stopping: Callable[[], bool]) -> None:
    """在单工作线程中执行一个运行，并在阶段边界响应取消或关闭。"""
    record = _get_run(run_id)
    if record is None or record.status != "queued" or application_stopping():
        return
    try:
        record.status = "generating_data"
        record.events.append(_event("generating_data"))
        if not _save_active_run(record):
            return
        record.artifacts, record.generation_metadata = generate_normal_artifacts(
            get_data_dir() / "runs" / str(record.id), record.configuration_snapshot
        )
        if _stop_requested(record, application_stopping):
            return

        record.status = "running_checks"
        record.events.append(_event("running_checks"))
        if not _save_active_run(record):
            return
        record.checks = [
            *run_video_checks(record.artifacts, get_data_dir(), record.configuration_snapshot),
            *run_imu_checks(record.artifacts, get_data_dir(), record.configuration_snapshot),
            *run_storage_checks(record.artifacts, get_data_dir(), record.configuration_snapshot),
            *(
                run_resource_checks(record.artifacts, get_data_dir(), record.configuration_snapshot)
                if record.configuration_snapshot.scenario == "temperature_combination"
                else []
            ),
        ]
        if record.configuration_snapshot.scenario == "temperature_combination":
            video_channel = record.configuration_snapshot.random_seed % record.configuration_snapshot.video.channels + 1
            evidence_by_check = {
                "video_frame_drop": [
                    "fault_truth:video_frame_drop",
                    f"video:camera_{video_channel}:temperature_window",
                ],
                "imu_missing_samples": ["fault_truth:imu_missing_sample", "imu:temperature_window"],
                "imu_interval_distribution": ["fault_truth:imu_missing_sample", "imu:temperature_window"],
            }
            for check in record.checks:
                check.evidence_refs = evidence_by_check.get(check.name, check.evidence_refs)
        record.alignment_result = (
            align_fixed_offset(record.artifacts, get_data_dir(), record.configuration_snapshot)
            or align_linear_drift(record.artifacts, get_data_dir(), record.configuration_snapshot)
        )
        record.evaluation_result = evaluate_run(
            record.checks, record.alignment_result, record.configuration_snapshot
        )
        if _stop_requested(record, application_stopping):
            return
        record.status = "summarizing_results"
        record.events.append(_event("summarizing_results"))
        if not _save_active_run(record) or _stop_requested(record, application_stopping):
            return

        record.status = "completed"
        record.completed_at = _now()
        record.events.append(_event("completed"))
        _save_active_run(record)
    except (OSError, RuntimeError, subprocess.SubprocessError):
        record.status = "failed"
        record.completed_at = _now()
        record.error = "正常场景文件生成失败"
        record.events.append(_event("failed"))
        _save_active_run(record)


def recover_unfinished_runs() -> None:
    """应用启动时把上次进程遗留的非终态运行标记为异常中断。"""
    recovered_at = _now()
    with open_database() as connection:
        rows = connection.execute(
            """
            SELECT id, events FROM runs
            WHERE status IN ('queued', 'generating_data', 'running_checks', 'summarizing_results')
            """
        ).fetchall()
        for row in rows:
            events = json.loads(row["events"])
            events.append(_event("interrupted").model_dump(mode="json"))
            connection.execute(
                """
                UPDATE runs SET status = 'interrupted', events = ?, completed_at = ?, error = ? WHERE id = ?
                """,
                (json.dumps(events), recovered_at.isoformat(), "应用重启时检测到未完成运行", row["id"]),
            )


@router.post("/api/collection-tasks/{task_id}/runs", response_model=RunRecord, status_code=status.HTTP_201_CREATED)
def execute_collection_task(task_id: int, request: Request) -> RunRecord:
    with open_database() as connection:
        task = connection.execute("SELECT configuration FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()
    if task is None:
        raise HTTPException(status_code=404, detail="采集任务不存在")
    snapshot = RunConfigurationSnapshot.model_validate_json(task["configuration"])
    record = _create_run(task_id, snapshot)
    request.app.state.run_executor.submit(record.id)
    return record


@router.post("/api/runs/{run_id}/cancel", response_model=RunRecord)
def cancel_run(run_id: int) -> RunRecord:
    record = _get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    if record.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail="运行记录已结束，不能取消")
    record.status = "cancelled"
    record.completed_at = _now()
    record.events.append(_event("cancelled"))
    if not _save_active_run(record):
        raise HTTPException(status_code=409, detail="运行记录状态已变化，请刷新后重试")
    return record


@router.post("/api/runs/{run_id}/rerun", response_model=RunRecord, status_code=status.HTTP_201_CREATED)
def rerun(run_id: int, request: Request) -> RunRecord:
    original = _get_run(run_id)
    if original is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    record = _create_run(original.collection_task_id, original.configuration_snapshot)
    request.app.state.run_executor.submit(record.id)
    return record


@router.get("/api/runs/{run_id}", response_model=RunRecord)
def get_run(run_id: int) -> RunRecord:
    record = _get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    return record


@router.post("/api/runs/{run_id}/alignment-review", response_model=RunRecord)
def review_alignment(run_id: int, command: AlignmentReviewCommand) -> RunRecord:
    """应用锚点复核并只替换分析快照，原始产物和检测结果保持不变。"""
    record = _get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    if record.alignment_result is None:
        raise HTTPException(status_code=409, detail="当前运行没有可复核的时间对齐结果")

    known_ids = {anchor.id for anchor in record.alignment_result.anchor_details}
    unknown_ids = [item.anchor_id for item in command.anchors if item.anchor_id not in known_ids]
    if unknown_ids:
        raise HTTPException(status_code=422, detail=f"未知锚点引用：{', '.join(unknown_ids)}")

    overrides = {
        item.anchor_id: (item.reviewed_time_s, item.included)
        for item in command.anchors
    }
    snapshot = record.configuration_snapshot
    alignment = (
        align_fixed_offset(
            record.artifacts,
            get_data_dir(),
            snapshot,
            overrides,
            record.alignment_result.review_revision + 1,
        )
        or align_linear_drift(
            record.artifacts,
            get_data_dir(),
            snapshot,
            overrides,
            record.alignment_result.review_revision + 1,
        )
    )
    if alignment is None:
        raise HTTPException(status_code=422, detail="复核后有效共同锚点不足，无法重新计算")

    with open_database() as connection:
        connection.execute(
            "UPDATE runs SET alignment_result = ? WHERE id = ?",
            (alignment.model_dump_json(), run_id),
        )
    record.alignment_result = alignment
    return record
