"""运行相关 HTTP 接口；路由契约保持与原模块一致。"""

import json
from datetime import UTC, datetime

from fastapi import HTTPException, Request, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.database import get_data_dir, open_database
from app.run_models import AlignmentReviewCommand, EvaluationConfiguration, RunConfigurationSnapshot, RunRecord
from app.run_router import router
from app.run_storage import create_run, event, save_active_run
from app.run_storage import get_run as storage_get_run
from app.time_alignment import align_fixed_offset, align_linear_drift, build_frame_imu_alignment


class ImportedRunCommand(BaseModel):
    """导入型运行启动前的人工配置；导入数据本身不接受合成场景。"""

    reference_channel: str = "camera_1"
    evaluation: EvaluationConfiguration | None = None


@router.post("/api/collection-tasks/{task_id}/runs", response_model=RunRecord, status_code=status.HTTP_201_CREATED)
def execute_collection_task(task_id: int, request: Request, command: ImportedRunCommand | None = None) -> RunRecord:
    with open_database() as connection:
        task = connection.execute("SELECT configuration FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()
    if task is None:
        raise HTTPException(status_code=404, detail="采集任务不存在")
    snapshot = RunConfigurationSnapshot.model_validate_json(task["configuration"])
    with open_database() as connection:
        imported = (
            connection.execute("SELECT source FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()["source"]
            == "imported_actual_data"
        )
    if imported:
        if command is None or command.evaluation is None:
            raise HTTPException(status_code=422, detail="导入型运行必须手工配置参考时钟和判定模式")
        snapshot = RunConfigurationSnapshot.model_validate(
            snapshot.model_copy(
                update={"reference_channel": command.reference_channel, "evaluation": command.evaluation}
            ).model_dump()
        )
    record = create_run(task_id, snapshot)
    request.app.state.run_executor.submit(record.id)
    return record


@router.post("/api/runs/{run_id}/cancel", response_model=RunRecord)
def cancel_run(run_id: int) -> RunRecord:
    record = storage_get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    if record.status in {"completed", "failed", "cancelled", "interrupted"}:
        raise HTTPException(status_code=409, detail="运行记录已结束，不能取消")
    record.status = "cancelled"
    record.completed_at = datetime.now(UTC)
    record.events.append(event("cancelled"))
    if not save_active_run(record):
        raise HTTPException(status_code=409, detail="运行记录状态已变化，请刷新后重试")
    return record


@router.post("/api/runs/{run_id}/rerun", response_model=RunRecord, status_code=status.HTTP_201_CREATED)
def rerun(run_id: int, request: Request) -> RunRecord:
    original = storage_get_run(run_id)
    if original is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    record = create_run(original.collection_task_id, original.configuration_snapshot)
    request.app.state.run_executor.submit(record.id)
    return record


@router.get("/api/runs/{run_id}", response_model=RunRecord)
def get_run_route(run_id: int) -> RunRecord:
    record = storage_get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    return record


@router.get("/api/runs/{run_id}/frame-imu-alignment.csv")
def get_frame_imu_alignment(run_id: int) -> Response:
    record = storage_get_run(run_id)
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
    record = storage_get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    videos = [item for item in record.artifacts if item.kind == "video"]
    index = next((i for i in range(1, len(videos) + 1) if f"camera_{i}" == channel), None)
    if index is None:
        raise HTTPException(status_code=404, detail="视频通道不存在")
    data_dir = get_data_dir().resolve()
    path = (data_dir / videos[index - 1].path).resolve()
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
    record = storage_get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    if record.alignment_result is None:
        raise HTTPException(status_code=409, detail="当前运行没有可复核的时间对齐结果")
    known = {anchor.id for anchor in record.alignment_result.anchor_details}
    unknown = [item.anchor_id for item in command.anchors if item.anchor_id not in known]
    if unknown:
        raise HTTPException(status_code=422, detail=f"未知锚点引用：{', '.join(unknown)}")
    overrides = {item.anchor_id: (item.reviewed_time_s, item.included) for item in command.anchors}
    snapshot = record.configuration_snapshot
    revision = record.alignment_result.review_revision + 1
    alignment = align_fixed_offset(
        record.artifacts, get_data_dir(), snapshot, overrides, revision
    ) or align_linear_drift(record.artifacts, get_data_dir(), snapshot, overrides, revision)
    if alignment is None:
        raise HTTPException(status_code=422, detail="复核后有效共同锚点不足，无法重新计算")
    artifact, summary = build_frame_imu_alignment(record.artifacts, get_data_dir(), snapshot, alignment)
    record.artifacts = [item for item in record.artifacts if item.kind != "frame_imu_alignment"] + [artifact]
    alignment = alignment.model_copy(update={"frame_imu_alignment": summary})
    with open_database() as connection:
        connection.execute(
            "UPDATE runs SET alignment_result=?, artifacts=? WHERE id=?",
            (alignment.model_dump_json(), json.dumps([a.model_dump(mode="json") for a in record.artifacts]), run_id),
        )
    record.alignment_result = alignment
    return record
