import json
import sqlite3
import subprocess
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status

from app.database import get_data_dir, open_database
from app.normal_generator import generate_normal_artifacts, run_basic_checks
from app.run_models import RunConfigurationSnapshot, RunRecord, StageEvent

router = APIRouter(tags=["runs"])

def _now() -> datetime:
    return datetime.now(UTC)


def _event(stage: str) -> StageEvent:
    return StageEvent(stage=stage, occurred_at=_now())


def _record_from_row(row: sqlite3.Row) -> RunRecord:
    return RunRecord(
        id=row["id"],
        collection_task_id=row["collection_task_id"],
        status=row["status"],
        configuration_snapshot=json.loads(row["configuration_snapshot"]),
        events=json.loads(row["events"]),
        artifacts=json.loads(row["artifacts"]),
        checks=json.loads(row["checks"]),
        generation_metadata=json.loads(row["generation_metadata"]) or None,
        created_at=row["created_at"],
        completed_at=row["completed_at"],
        error=row["error"],
    )


def _save_run(record: RunRecord) -> None:
    with open_database() as connection:
        connection.execute(
            """
            UPDATE runs
            SET status = ?, events = ?, artifacts = ?, checks = ?, generation_metadata = ?, completed_at = ?, error = ?
            WHERE id = ?
            """,
            (
                record.status,
                json.dumps([event.model_dump(mode="json") for event in record.events]),
                json.dumps([artifact.model_dump(mode="json") for artifact in record.artifacts]),
                json.dumps([check.model_dump(mode="json") for check in record.checks]),
                record.generation_metadata.model_dump_json() if record.generation_metadata else "{}",
                record.completed_at.isoformat() if record.completed_at else None,
                record.error,
                record.id,
            ),
        )


@router.post(
    "/api/collection-tasks/{task_id}/runs",
    response_model=RunRecord,
    status_code=status.HTTP_201_CREATED,
)
def execute_collection_task(task_id: int) -> RunRecord:
    created_at = _now()
    events = [_event("queued")]
    with open_database() as connection:
        task = connection.execute("SELECT id, configuration FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()
        if task is None:
            raise HTTPException(status_code=404, detail="采集任务不存在")
        snapshot = RunConfigurationSnapshot.model_validate_json(task["configuration"])
        cursor = connection.execute(
            """
            INSERT INTO runs (
                collection_task_id, status, configuration_snapshot, events, artifacts, checks, created_at
            ) VALUES (?, 'queued', ?, ?, '[]', '[]', ?)
            """,
            (
                task_id,
                snapshot.model_dump_json(),
                json.dumps([event.model_dump(mode="json") for event in events]),
                created_at.isoformat(),
            ),
        )
        run_id = cursor.lastrowid

    if run_id is None:
        raise HTTPException(status_code=500, detail="运行记录创建失败")

    record = RunRecord(
        id=run_id,
        collection_task_id=task_id,
        status="queued",
        configuration_snapshot=snapshot,
        events=events,
        artifacts=[],
        generation_metadata=None,
        checks=[],
        created_at=created_at,
        completed_at=None,
        error=None,
    )
    try:
        record.status = "generating_data"
        record.events.append(_event("generating_data"))
        record.artifacts, record.generation_metadata = generate_normal_artifacts(
            get_data_dir() / "runs" / str(run_id), snapshot
        )
        record.status = "running_checks"
        record.events.append(_event("running_checks"))
        record.checks = run_basic_checks(record.artifacts, get_data_dir(), snapshot)
        record.status = "summarizing_results"
        record.events.append(_event("summarizing_results"))
        record.status = "completed"
        record.completed_at = _now()
        record.events.append(_event("completed"))
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        record.status = "failed"
        record.error = "正常场景文件生成失败"
        _save_run(record)
        raise HTTPException(status_code=500, detail=record.error) from error

    _save_run(record)
    return record


@router.get("/api/runs/{run_id}", response_model=RunRecord)
def get_run(run_id: int) -> RunRecord:
    with open_database() as connection:
        row = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    return _record_from_row(row)
