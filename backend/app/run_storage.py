"""运行记录的持久化与导入产物读取。"""

import json
import sqlite3
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path

from fastapi import HTTPException

from app.database import get_data_dir, open_database
from app.manual_check_results import list_manual_results
from app.run_models import Artifact, BasicCheck, RunConfigurationSnapshot, RunRecord, StageEvent


def is_imported_task(task_id: int) -> bool:
    with open_database() as connection:
        row = connection.execute("SELECT source FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()
    return bool(row and row["source"] == "imported_actual_data")


def imported_artifact(kind: str, path: Path, codec: str | None = None, start_timestamp: int | None = None) -> Artifact:
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


def imported_artifacts(task_id: int) -> list[Artifact]:
    """从已入库的不可变目录建立运行产物清单，不复制或修改原始文件。"""
    with open_database() as connection:
        row = connection.execute(
            "SELECT formal_path, validation_result FROM import_records WHERE created_task_id = ?", (task_id,)
        ).fetchone()
    if row is None or not row["formal_path"]:
        raise RuntimeError("导入原始数据记录不存在")
    root = Path(row["formal_path"]) / "extracted"
    manifest = json.loads(row["validation_result"]).get("manifest") or {}
    artifacts = [
        imported_artifact("video", root / item["path"], item.get("codec"), item.get("start_raw_device_timestamp_ns"))
        for item in manifest.get("videos", [])
    ]
    artifacts.append(imported_artifact("imu", root / (manifest.get("imu") or {})["path"]))
    for kind, names in {
        "device_status": ("device-status.json", "device_status.json"),
        "device_log": ("device.log", "device-log.json"),
    }.items():
        path = next((root / name for name in names if (root / name).is_file()), None)
        if path is not None:
            artifacts.append(imported_artifact(kind, path))
    return artifacts


def now() -> datetime:
    return datetime.now(UTC)


def event(stage: str) -> StageEvent:
    return StageEvent(stage=stage, occurred_at=now())


def not_run_check(name: str, category: str, message: str) -> BasicCheck:
    """明确区分缺少可选证据与自动检查通过。"""
    return BasicCheck(name=name, category=category, status="not_run", message=message)


def record_from_row(row: sqlite3.Row) -> RunRecord:
    with open_database() as connection:
        task_name = connection.execute(
            "SELECT name FROM collection_tasks WHERE id = ?", (row["collection_task_id"],)
        ).fetchone()["name"]
        queue_position = (
            connection.execute(
                "SELECT COUNT(*) + 1 FROM runs WHERE status = 'queued' AND id < ?", (row["id"],)
            ).fetchone()[0]
            if row["status"] == "queued"
            else None
        )
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
        alignment_result=json.loads(row["alignment_result"]) or None,
        evaluation_result=json.loads(row["evaluation_result"]) or None,
        manual_check_results=list_manual_results(row["id"]),
        generation_metadata=json.loads(row["generation_metadata"]) or None,
        created_at=row["created_at"],
        completed_at=row["completed_at"],
        error=row["error"],
    )


def get_run(run_id: int) -> RunRecord | None:
    with open_database() as connection:
        row = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    return record_from_row(row) if row else None


def save_active_run(record: RunRecord) -> bool:
    """只更新非终态记录，避免工作线程覆盖并发取消结果。"""
    with open_database() as connection:
        cursor = connection.execute(
            """UPDATE runs SET status=?, events=?, artifacts=?, checks=?, generation_metadata=?,
            alignment_result=?, evaluation_result=?, completed_at=?, error=? WHERE id=?
            AND status IN ('queued','generating_data','running_checks','summarizing_results')""",
            (
                record.status,
                json.dumps([e.model_dump(mode="json") for e in record.events]),
                json.dumps([a.model_dump(mode="json") for a in record.artifacts]),
                json.dumps([c.model_dump(mode="json") for c in record.checks]),
                record.generation_metadata.model_dump_json() if record.generation_metadata else "{}",
                record.alignment_result.model_dump_json() if record.alignment_result else "{}",
                record.evaluation_result.model_dump_json() if record.evaluation_result else "{}",
                record.completed_at.isoformat() if record.completed_at else None,
                record.error,
                record.id,
            ),
        )
    return cursor.rowcount == 1


def save_cancelled_evidence(record: RunRecord) -> None:
    """取消不删除已经生成的证据，只阻止后续阶段继续执行。"""
    with open_database() as connection:
        connection.execute(
            (
                "UPDATE runs SET artifacts=?, checks=?, generation_metadata=?, alignment_result=?, "
                "evaluation_result=? WHERE id=? AND status='cancelled'"
            ),
            (
                json.dumps([a.model_dump(mode="json") for a in record.artifacts]),
                json.dumps([c.model_dump(mode="json") for c in record.checks]),
                record.generation_metadata.model_dump_json() if record.generation_metadata else "{}",
                record.alignment_result.model_dump_json() if record.alignment_result else "{}",
                record.evaluation_result.model_dump_json() if record.evaluation_result else "{}",
                record.id,
            ),
        )


def create_run(collection_task_id: int, snapshot: RunConfigurationSnapshot) -> RunRecord:
    created_at = now()
    events = [event("queued")]
    with open_database() as connection:
        task_name = connection.execute(
            "SELECT name FROM collection_tasks WHERE id = ?", (collection_task_id,)
        ).fetchone()["name"]
        number = connection.execute(
            "SELECT COUNT(*) + 1 FROM runs WHERE collection_task_id = ?", (collection_task_id,)
        ).fetchone()[0]
        cursor = connection.execute(
            (
                "INSERT INTO runs (collection_task_id,status,configuration_snapshot,events,artifacts, "
                "checks,created_at,task_execution_number) VALUES (?, 'queued', ?, ?, '[]', '[]', ?, ?)"
            ),
            (
                collection_task_id,
                snapshot.model_dump_json(),
                json.dumps([e.model_dump(mode="json") for e in events]),
                created_at.isoformat(),
                number,
            ),
        )
        run_id = cursor.lastrowid
    if run_id is None:
        raise HTTPException(status_code=500, detail="运行记录创建失败")
    with open_database() as connection:
        queue_position = connection.execute(
            "SELECT COUNT(*) FROM runs WHERE status='queued' AND id <= ?", (run_id,)
        ).fetchone()[0]
    return RunRecord(
        id=run_id,
        collection_task_id=collection_task_id,
        task_name=task_name,
        task_execution_number=number,
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
