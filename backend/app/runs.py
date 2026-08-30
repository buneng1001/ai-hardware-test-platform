import json
import sqlite3
import subprocess
from collections.abc import Callable
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.database import get_data_dir, open_database
from app.evaluation import evaluate_run
from app.imu_checks import run_imu_checks
from app.manual_check_results import list_manual_results
from app.normal_generator import generate_normal_artifacts
from app.resource_checks import run_resource_checks
from app.run_models import (
    AlignmentReviewCommand,
    BasicCheck,
    EvaluationConfiguration,
    RunConfigurationSnapshot,
    RunRecord,
    StageEvent,
)
from app.storage_checks import run_storage_checks
from app.time_alignment import align_fixed_offset, align_imported_data, align_linear_drift, build_frame_imu_alignment
from app.video_checks import run_video_checks

router = APIRouter(tags=["runs"])

TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}


class ImportedRunCommand(BaseModel):
    """导入型运行启动前的人工配置；导入数据本身不接受合成场景。"""

    reference_channel: str = "camera_1"
    evaluation: EvaluationConfiguration | None = None


def _is_imported_task(task_id: int) -> bool:
    with open_database() as connection:
        row = connection.execute("SELECT source FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()
    return bool(row and row["source"] == "imported_actual_data")


def _imported_artifacts(task_id: int):
    """从已入库的不可变目录建立运行产物清单，不复制或修改原始文件。"""
    with open_database() as connection:
        row = connection.execute(
            "SELECT formal_path, validation_result FROM import_records WHERE created_task_id = ?", (task_id,)
        ).fetchone()
    if row is None or not row["formal_path"]:
        raise RuntimeError("导入原始数据记录不存在")
    root = Path(row["formal_path"]) / "extracted"
    validation = json.loads(row["validation_result"])
    manifest = validation.get("manifest") or {}
    artifacts = []
    for video in manifest.get("videos", []):
        path = root / video["path"]
        artifacts.append(
            _imported_artifact("video", path, video.get("codec"), video.get("start_raw_device_timestamp_ns"))
        )
    imu = manifest.get("imu") or {}
    artifacts.append(_imported_artifact("imu", root / imu["path"]))
    optional_paths = {
        "device_status": ("device-status.json", "device_status.json"),
        "device_log": ("device.log", "device-log.json"),
    }
    for kind, names in optional_paths.items():
        path = next((root / name for name in names if (root / name).is_file()), None)
        if path is not None:
            artifacts.append(_imported_artifact(kind, path))
    return artifacts


def _not_run_check(name: str, category: str, message: str) -> BasicCheck:
    """明确区分缺少可选证据与自动检查通过。"""
    return BasicCheck(name=name, category=category, status="not_run", message=message)


def _imported_artifact(kind: str, path: Path, codec: str | None = None, start_timestamp: int | None = None):
    from app.run_models import Artifact

    content = path.read_bytes()
    return Artifact(
        kind=kind,
        path=path.relative_to(get_data_dir()).as_posix(),
        source="imported_actual_data",
        size_bytes=len(content),
        sha256=sha256(content).hexdigest(),
        codec=codec,
        start_raw_device_timestamp_ns=start_timestamp,
    )


def _now() -> datetime:
    return datetime.now(UTC)


def _event(stage: str) -> StageEvent:
    return StageEvent(stage=stage, occurred_at=_now())


def _record_from_row(row: sqlite3.Row) -> RunRecord:
    alignment_raw = json.loads(row["alignment_result"])
    with open_database() as connection:
        task_name = connection.execute(
            "SELECT name FROM collection_tasks WHERE id = ?", (row["collection_task_id"],)
        ).fetchone()["name"]
        queue_position = None
        if row["status"] == "queued":
            queue_position = connection.execute(
                "SELECT COUNT(*) + 1 FROM runs WHERE status = 'queued' AND id < ?", (row["id"],)
            ).fetchone()[0]
    return RunRecord(
        id=row["id"],
        collection_task_id=row["collection_task_id"],
        task_name=task_name,
        task_execution_number=row["task_execution_number"],
        queue_position=queue_position,
        stage_status=row["status"],
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
        task_name = connection.execute(
            "SELECT name FROM collection_tasks WHERE id = ?", (collection_task_id,)
        ).fetchone()["name"]
        task_execution_number = connection.execute(
            "SELECT COUNT(*) + 1 FROM runs WHERE collection_task_id = ?", (collection_task_id,)
        ).fetchone()[0]
        cursor = connection.execute(
            """
            INSERT INTO runs (
                collection_task_id, status, configuration_snapshot, events, artifacts, checks,
                created_at, task_execution_number
            ) VALUES (?, 'queued', ?, ?, '[]', '[]', ?, ?)
            """,
            (
                collection_task_id,
                snapshot.model_dump_json(),
                json.dumps([event.model_dump(mode="json") for event in events]),
                created_at.isoformat(),
                task_execution_number,
            ),
        )
        run_id = cursor.lastrowid
    if run_id is None:
        raise HTTPException(status_code=500, detail="运行记录创建失败")
    with open_database() as connection:
        queue_position = connection.execute(
            "SELECT COUNT(*) FROM runs WHERE status = 'queued' AND id <= ?", (run_id,)
        ).fetchone()[0]
    return RunRecord(
        id=run_id,
        collection_task_id=collection_task_id,
        task_name=task_name,
        task_execution_number=task_execution_number,
        queue_position=queue_position,
        stage_status="queued",
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
        if _is_imported_task(record.collection_task_id):
            record.artifacts = _imported_artifacts(record.collection_task_id)
            record.generation_metadata = None
        else:
            record.artifacts, record.generation_metadata = generate_normal_artifacts(
                get_data_dir() / "runs" / str(record.id), record.configuration_snapshot
            )
        if _stop_requested(record, application_stopping):
            return

        record.status = "running_checks"
        record.events.append(_event("running_checks"))
        if not _save_active_run(record):
            return
        if _is_imported_task(record.collection_task_id):
            record.checks = [
                *run_video_checks(record.artifacts, get_data_dir(), record.configuration_snapshot),
                *run_imu_checks(record.artifacts, get_data_dir(), record.configuration_snapshot),
            ]
            if not any(artifact.kind == "device_status" for artifact in record.artifacts):
                record.checks.append(_not_run_check("storage_exhaustion", "storage", "缺少设备状态证据，未执行"))
                record.checks.append(_not_run_check("storage_premature_stop", "storage", "缺少设备状态证据，未执行"))
            if not any(artifact.kind == "device_log" for artifact in record.artifacts):
                record.checks.append(_not_run_check("storage_log_correlation", "storage", "缺少设备日志证据，未执行"))
        else:
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
        if _is_imported_task(record.collection_task_id):
            record.alignment_result = align_imported_data(
                record.artifacts, get_data_dir(), record.configuration_snapshot
            )
        else:
            record.alignment_result = align_fixed_offset(
                record.artifacts, get_data_dir(), record.configuration_snapshot
            ) or align_linear_drift(record.artifacts, get_data_dir(), record.configuration_snapshot)
        if record.alignment_result is not None:
            mapping_artifact, mapping_summary = build_frame_imu_alignment(
                record.artifacts,
                get_data_dir(),
                record.configuration_snapshot,
                record.alignment_result,
                get_data_dir() / "runs" / str(record.id) if _is_imported_task(record.collection_task_id) else None,
            )
            record.artifacts.append(mapping_artifact)
            record.alignment_result = record.alignment_result.model_copy(
                update={"frame_imu_alignment": mapping_summary}
            )
        record.evaluation_result = evaluate_run(record.checks, record.alignment_result, record.configuration_snapshot)
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
    except (KeyError, OSError, RuntimeError, TypeError, ValueError, subprocess.SubprocessError):
        record.status = "failed"
        record.completed_at = _now()
        record.error = "运行处理失败，请检查输入数据和配置"
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
def execute_collection_task(
    task_id: int, request: Request, command: ImportedRunCommand | None = None
) -> RunRecord:
    with open_database() as connection:
        task = connection.execute("SELECT configuration FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()
    if task is None:
        raise HTTPException(status_code=404, detail="采集任务不存在")
    snapshot = RunConfigurationSnapshot.model_validate_json(task["configuration"])
    if _is_imported_task(task_id):
        if command is None or command.evaluation is None:
            raise HTTPException(status_code=422, detail="导入型运行必须手工配置参考时钟和判定模式")
        snapshot = snapshot.model_copy(
            update={
                "reference_channel": command.reference_channel,
                "evaluation": command.evaluation,
            }
        )
        snapshot = RunConfigurationSnapshot.model_validate(snapshot.model_dump())
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


@router.get("/api/runs/{run_id}/frame-imu-alignment.csv")
def get_frame_imu_alignment(run_id: int) -> Response:
    """下载独立逐帧映射，不把派生时间写回原始视频或 IMU。"""
    record = _get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    artifact = next((item for item in record.artifacts if item.kind == "frame_imu_alignment"), None)
    if artifact is None:
        raise HTTPException(status_code=404, detail="该运行没有逐帧映射产物")
    path = (get_data_dir() / artifact.path).resolve()
    try:
        path.relative_to(get_data_dir().resolve())
    except ValueError as error:
        raise HTTPException(status_code=500, detail="逐帧映射路径不安全") from error
    if not path.is_file():
        raise HTTPException(status_code=404, detail="逐帧映射产物不存在")
    return Response(
        content=path.read_bytes(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="run-{run_id}-frame-imu-alignment.csv"'},
    )


@router.get("/api/runs/{run_id}/videos/{channel}")
def download_raw_video(run_id: int, channel: str) -> FileResponse:
    """按视频通道单独下载完整原始视频，不把它放进默认证据包。"""
    record = _get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    video_artifacts = [item for item in record.artifacts if item.kind == "video"]
    channel_index = next(
        (index for index in range(1, len(video_artifacts) + 1) if f"camera_{index}" == channel),
        None,
    )
    if channel_index is None:
        raise HTTPException(status_code=404, detail="视频通道不存在")
    artifact = video_artifacts[channel_index - 1]
    data_dir = get_data_dir().resolve()
    path = (data_dir / artifact.path).resolve()
    try:
        path.relative_to(data_dir)
    except ValueError as error:
        raise HTTPException(status_code=500, detail="原始视频路径不安全") from error
    if not path.is_file():
        raise HTTPException(status_code=404, detail="原始视频不存在")
    return FileResponse(
        path,
        media_type="video/mp4" if path.suffix.lower() == ".mp4" else "video/x-matroska",
        filename=f"run-{run_id}-{channel}{path.suffix.lower()}",
    )


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

    overrides = {item.anchor_id: (item.reviewed_time_s, item.included) for item in command.anchors}
    snapshot = record.configuration_snapshot
    alignment = align_fixed_offset(
        record.artifacts,
        get_data_dir(),
        snapshot,
        overrides,
        record.alignment_result.review_revision + 1,
    ) or align_linear_drift(
        record.artifacts,
        get_data_dir(),
        snapshot,
        overrides,
        record.alignment_result.review_revision + 1,
    )
    if alignment is None:
        raise HTTPException(status_code=422, detail="复核后有效共同锚点不足，无法重新计算")

    alignment = alignment.model_copy(
        update={"frame_imu_alignment": record.alignment_result.frame_imu_alignment}
    )
    mapping_artifact, mapping_summary = build_frame_imu_alignment(
        record.artifacts,
        get_data_dir(),
        snapshot,
        alignment,
    )
    record.artifacts = [
        item for item in record.artifacts if item.kind != "frame_imu_alignment"
    ] + [mapping_artifact]
    alignment = alignment.model_copy(update={"frame_imu_alignment": mapping_summary})
    with open_database() as connection:
        connection.execute(
            "UPDATE runs SET alignment_result = ? WHERE id = ?",
            (alignment.model_dump_json(), run_id),
        )
        connection.execute(
            "UPDATE runs SET artifacts = ? WHERE id = ?",
            (json.dumps([artifact.model_dump(mode="json") for artifact in record.artifacts]), run_id),
        )
    record.alignment_result = alignment
    return record
