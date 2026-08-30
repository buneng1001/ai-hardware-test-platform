import hashlib
import json
import os
import shutil
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.collection_tasks import task_from_row
from app.database import get_data_dir, open_database
from app.import_validation import MAX_ARCHIVE_BYTES, VALIDATOR_VERSION, validate_archive

router = APIRouter(prefix="/api/imports", tags=["actual data imports"])


class ImportRecord(BaseModel):
    id: int
    sha256: str
    source_filename: str
    first_imported_at: datetime
    validator_version: str
    status: str
    permission_confirmed: bool
    validation: dict[str, object]
    created_task_id: int | None = None


class CreateImportedTaskCommand(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    label: str = Field(default="", max_length=80)


def _record_from_row(row) -> ImportRecord:
    return ImportRecord(
        id=row["id"],
        sha256=row["sha256"],
        source_filename=row["source_filename"],
        first_imported_at=row["first_imported_at"],
        validator_version=row["validator_version"],
        status=row["status"],
        permission_confirmed=bool(row["permission_confirmed"]),
        validation=json.loads(row["validation_result"]),
        created_task_id=row["created_task_id"],
    )


@router.post("", response_model=ImportRecord, status_code=status.HTTP_201_CREATED)
async def upload_import(file: UploadFile = File(...), permission_confirmed: bool = Form(...)) -> ImportRecord:
    if not permission_confirmed:
        raise HTTPException(status_code=422, detail="请先确认具有处理和展示这些数据的权限")
    if not file.filename or Path(file.filename).suffix.lower() != ".zip":
        raise HTTPException(status_code=422, detail="一次只能导入 ZIP 文件")

    data_dir = get_data_dir()
    stage = data_dir / "imports" / "staging" / uuid.uuid4().hex
    stage.mkdir(parents=True, exist_ok=False)
    archive_path = stage / "source.zip"
    digest = hashlib.sha256()
    size = 0
    try:
        with archive_path.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_ARCHIVE_BYTES:
                    raise HTTPException(status_code=413, detail="ZIP 文件超过 2GiB 限制")
                digest.update(chunk)
                output.write(chunk)
    except HTTPException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    finally:
        await file.close()

    sha256 = digest.hexdigest()
    with open_database() as connection:
        duplicate = connection.execute("SELECT * FROM import_records WHERE sha256 = ?", (sha256,)).fetchone()
        if duplicate is not None:
            shutil.rmtree(stage, ignore_errors=True)
            raise HTTPException(
                status_code=409,
                detail={"message": "该 ZIP 已导入", "existing_import_id": duplicate["id"]},
            )
        now = datetime.now(UTC).isoformat()
        cursor = connection.execute(
            "INSERT INTO import_records "
            "(sha256, source_filename, first_imported_at, validator_version, status, "
            "permission_confirmed, staging_path) "
            "VALUES (?, ?, ?, ?, 'uploaded', 1, ?)",
            (sha256, file.filename, now, VALIDATOR_VERSION, str(stage)),
        )
        row = connection.execute("SELECT * FROM import_records WHERE id = ?", (cursor.lastrowid,)).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="导入记录保存失败")
    return _record_from_row(row)


@router.post("/{import_id}/validate", response_model=ImportRecord)
def validate_import(import_id: int) -> ImportRecord:
    with open_database() as connection:
        row = connection.execute("SELECT * FROM import_records WHERE id = ?", (import_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="导入记录不存在")
    if row["created_task_id"] is not None:
        return _record_from_row(row)
    stage = Path(row["staging_path"])
    result = validate_archive(stage / "source.zip", stage / "extracted")
    with open_database() as connection:
        connection.execute(
            "UPDATE import_records SET status = ?, validation_result = ? WHERE id = ?",
            (result["status"], json.dumps(result, ensure_ascii=False), import_id),
        )
        updated = connection.execute("SELECT * FROM import_records WHERE id = ?", (import_id,)).fetchone()
    if updated is None:
        raise HTTPException(status_code=500, detail="导入校验状态保存失败")
    if result["status"] == "failed":
        raise HTTPException(status_code=422, detail=result)
    return _record_from_row(updated)


@router.post("/{import_id}/convert", status_code=status.HTTP_409_CONFLICT)
def convert_import(import_id: int) -> None:
    raise HTTPException(status_code=409, detail="标准格式转换功能开发中")


@router.post("/{import_id}/create-task", status_code=status.HTTP_201_CREATED)
def create_imported_task(import_id: int, command: CreateImportedTaskCommand):
    formal_path: Path | None = None
    with open_database() as connection:
        row = connection.execute("SELECT * FROM import_records WHERE id = ?", (import_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="导入记录不存在")
        if row["created_task_id"] is not None:
            raise HTTPException(status_code=409, detail="该导入已加入任务列表")
        validation = json.loads(row["validation_result"])
        if row["status"] != "passed":
            raise HTTPException(status_code=409, detail="导入校验未通过，不能加入任务列表")
        manifest = validation.get("manifest") or {}
        video = (manifest.get("videos") or [{}])[0]
        imu = manifest.get("imu") or {}
        configuration = {
            "mode": "custom",
            "scenario": "normal",
            "duration_seconds": 2,
            "video": {
                "channels": len(manifest.get("videos") or [video]),
                "resolution": video.get("resolution", "640x360"),
                "fps": video.get("fps", 30),
                "container": video.get(
                    "container", Path(video.get("path", "video.mp4")).suffix.removeprefix(".") or "mp4"
                ),
                "codec": "h264",
                "bitrate_kbps": video.get("bitrate_kbps", 2500),
                "bitrate_mode": "cbr",
            },
            "imu": {
                "format": imu.get("format", "csv"),
                "sample_rate_hz": max(100, int(imu.get("sample_rate_hz", 100))),
            },
            "random_seed": 0,
            "reference_channel": "camera_1",
            "evaluation": {},
        }
        now = datetime.now(UTC).isoformat()
        stage_path = Path(row["staging_path"])
        formal_path = get_data_dir() / "imports" / row["sha256"]
        _move_to_formal_path(stage_path, formal_path)
        try:
            cursor = connection.execute(
                "INSERT INTO collection_tasks "
                "(name, label, mode, scenario, status, created_at, configuration, source) "
                "VALUES (?, ?, 'custom', 'normal', 'draft', ?, ?, 'imported_actual_data')",
                (command.name.strip(), command.label.strip(), now, json.dumps(configuration, ensure_ascii=False)),
            )
            task_id = cursor.lastrowid
            connection.execute(
                "UPDATE import_records SET status = 'imported', created_task_id = ?, formal_path = ? WHERE id = ?",
                (task_id, str(formal_path), import_id),
            )
            task_row = connection.execute("SELECT * FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()
        except Exception:
            if formal_path.exists() and not stage_path.exists():
                os.replace(formal_path, stage_path)
            raise
    if task_row is None:
        raise HTTPException(status_code=500, detail="导入任务创建失败")
    return task_from_row(task_row)


@router.delete("/{import_id}/staging", status_code=status.HTTP_204_NO_CONTENT)
def remove_import_staging(import_id: int) -> None:
    with open_database() as connection:
        row = connection.execute(
            "SELECT staging_path, created_task_id FROM import_records WHERE id = ?",
            (import_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="导入记录不存在")
        if row["created_task_id"] is not None:
            raise HTTPException(status_code=409, detail="已入库的原始导入不可移除")
        connection.execute("DELETE FROM import_records WHERE id = ?", (import_id,))
    shutil.rmtree(row["staging_path"], ignore_errors=True)


def cleanup_expired_staging() -> None:
    """启动时清理超过 24 小时且尚未入库的临时导入目录。"""
    cutoff = datetime.now(UTC) - timedelta(hours=24)
    expired: list[str] = []
    with open_database() as connection:
        rows = connection.execute(
            "SELECT id, staging_path, first_imported_at FROM import_records WHERE created_task_id IS NULL"
        ).fetchall()
        for row in rows:
            try:
                imported_at = datetime.fromisoformat(row["first_imported_at"])
            except ValueError:
                continue
            if imported_at < cutoff:
                expired.append(row["staging_path"])
                connection.execute("DELETE FROM import_records WHERE id = ?", (row["id"],))
    staging_root = (get_data_dir() / "imports" / "staging").resolve()
    for raw_path in expired:
        path = Path(raw_path).resolve()
        try:
            path.relative_to(staging_root)
        except ValueError:
            continue
        shutil.rmtree(path, ignore_errors=True)


def _move_to_formal_path(stage: Path, formal_path: Path) -> None:
    formal_path.parent.mkdir(parents=True, exist_ok=True)
    if formal_path.exists():
        return
    os.replace(stage, formal_path)
