"""将 v0.1.0 任务运行的合规输出登记为不可变数据包。"""

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response, status

from app.data_package_models import (
    DataKind,
    DataPackage,
    DataPackageDeletionImpact,
    DataPackagePage,
    SourceType,
    ValidationStatus,
)
from app.database import get_data_dir, open_database
from app.run_models import RunRecord, Scenario

router = APIRouter(prefix="/api/data-packages", tags=["data packages"])


def _source_type(value: str) -> SourceType:
    return "imported" if value == "imported_actual_data" else "generated"


def _package_kind(scenario: Scenario) -> tuple[DataKind, Scenario | None]:
    return ("normal", None) if scenario == "normal" else ("fault", scenario)


def _relative_artifact_path(path: str) -> Path | None:
    root = get_data_dir().resolve()
    candidate = (root / path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate


def _snapshot_files(record: RunRecord) -> tuple[list[dict[str, object]], dict[str, object], ValidationStatus, str]:
    files = [artifact.model_dump(mode="json") for artifact in record.artifacts]
    missing_files: list[str] = []
    size_mismatches: list[str] = []
    for artifact in record.artifacts:
        path = _relative_artifact_path(artifact.path)
        if path is None or not path.is_file():
            missing_files.append(artifact.path)
        elif path.stat().st_size != artifact.size_bytes:
            size_mismatches.append(artifact.path)
    valid = any(item["kind"] == "video" for item in files) and any(item["kind"] == "imu" for item in files)
    valid = valid and not missing_files and not size_mismatches
    integrity = {
        "status": "passed" if valid else "failed",
        "checked_file_count": len(files),
        "missing_files": missing_files,
        "size_mismatches": size_mismatches,
    }
    message = "数据包文件、视频和 IMU 通道已通过完整性校验" if valid else "数据包不完整，不能用于测试组"
    return files, integrity, integrity["status"], message


def _insert_data_package(connection: sqlite3.Connection, record: RunRecord) -> None:
    """一次完成运行只登记一次，绝不覆盖已有数据包快照。"""
    if record.status != "completed" or record.completed_at is None:
        return
    files, integrity, validation_status, validation_message = _snapshot_files(record)
    source_type = _source_type(files[0]["source"] if files else "actual_generated")
    data_kind, fault_type = _package_kind(record.configuration_snapshot.scenario)
    fingerprint_source = record.generation_metadata.reproducibility_fingerprint if record.generation_metadata else ""
    fingerprint = (
        fingerprint_source or hashlib.sha256("|".join(str(item["sha256"]) for item in files).encode()).hexdigest()
    )
    channels = [f"camera_{index}" for index, item in enumerate(files, start=1) if item["kind"] == "video"]
    starts = [item["start_raw_device_timestamp_ns"] for item in files if item["start_raw_device_timestamp_ns"]]
    timestamps = {
        "first_raw_device_timestamp_ns": min(starts) if starts else None,
        "generated_at": record.completed_at.isoformat(),
    }
    connection.execute(
        """
        INSERT OR IGNORE INTO data_packages
            (source_task_id, source_run_id, source_type, data_kind, fault_type, version_fingerprint,
             generated_at, validation_status, validation_message, files, channels, timestamps, integrity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record.collection_task_id,
            record.id,
            source_type,
            data_kind,
            fault_type,
            fingerprint,
            record.completed_at.isoformat(),
            validation_status,
            validation_message,
            json.dumps(files, ensure_ascii=False),
            json.dumps(channels, ensure_ascii=False),
            json.dumps(timestamps, ensure_ascii=False),
            json.dumps(integrity, ensure_ascii=False),
            datetime.now(UTC).isoformat(),
        ),
    )


def register_data_package_from_completed_run(record: RunRecord, connection: sqlite3.Connection | None = None) -> None:
    """一次完成运行只登记一次，绝不覆盖已有数据包快照。"""
    if record.status != "completed" or record.completed_at is None:
        return
    if connection is not None:
        _insert_data_package(connection, record)
        return
    with open_database() as database:
        _insert_data_package(database, record)


def _package_from_row(connection: sqlite3.Connection, row: sqlite3.Row, include_files: bool = False) -> DataPackage:
    latest = connection.execute(
        "SELECT source_run_id FROM data_packages WHERE source_task_id = ? ORDER BY generated_at DESC, id DESC LIMIT 1",
        (row["source_task_id"],),
    ).fetchone()
    recommended_run_id = latest["source_run_id"] if latest and latest["source_run_id"] != row["source_run_id"] else None
    return DataPackage(
        id=row["id"],
        package_number=f"DP-{row['id']:06d}",
        source_task_id=row["source_task_id"],
        source_task_name=row["source_task_name"],
        source_run_id=row["source_run_id"],
        source_run_execution_number=row["task_execution_number"],
        source_type=row["source_type"],
        data_kind=row["data_kind"],
        fault_type=row["fault_type"],
        version_fingerprint=row["version_fingerprint"],
        generated_at=row["generated_at"],
        validation_status=row["validation_status"],
        validation_message=row["validation_message"],
        channels=json.loads(row["channels"]),
        timestamps=json.loads(row["timestamps"]),
        integrity=json.loads(row["integrity"]),
        eligible_for_test_group=row["validation_status"] == "passed",
        has_newer_source_result=recommended_run_id is not None,
        recommended_source_run_id=recommended_run_id,
        files=json.loads(row["files"]) if include_files else [],
    )


def _query_packages(connection: sqlite3.Connection, where: list[str], parameters: list[object]) -> list[sqlite3.Row]:
    return connection.execute(
        f"""
        SELECT p.*, t.name AS source_task_name, r.task_execution_number
        FROM data_packages p
        JOIN collection_tasks t ON t.id = p.source_task_id
        JOIN runs r ON r.id = p.source_run_id
        {"WHERE " + " AND ".join(where) if where else ""}
        ORDER BY p.generated_at DESC, p.id DESC
        """,
        parameters,
    ).fetchall()


@router.get("", response_model=DataPackagePage)
def list_data_packages(
    source_type: SourceType | None = None,
    data_kind: DataKind | None = None,
    fault_type: Scenario | None = None,
    validation_status: ValidationStatus | None = None,
) -> DataPackagePage:
    where: list[str] = []
    parameters: list[object] = []
    for column, value in {
        "p.source_type": source_type,
        "p.data_kind": data_kind,
        "p.fault_type": fault_type,
        "p.validation_status": validation_status,
    }.items():
        if value is not None:
            where.append(f"{column} = ?")
            parameters.append(value)
    with open_database() as connection:
        rows = _query_packages(connection, where, parameters)
        return DataPackagePage(items=[_package_from_row(connection, row) for row in rows])


@router.post("/register-completed-runs", response_model=DataPackagePage)
def register_completed_runs() -> DataPackagePage:
    """把上线前已完成的 v0.1.0 运行补登记为数据包，不修改原运行记录。"""
    with open_database() as connection:
        run_ids = [row["id"] for row in connection.execute("SELECT id FROM runs WHERE status = 'completed'").fetchall()]
    from app.run_storage import get_run

    for run_id in run_ids:
        record = get_run(run_id)
        if record is not None:
            register_data_package_from_completed_run(record)
    return list_data_packages()


@router.get("/{data_package_id}", response_model=DataPackage)
def get_data_package(data_package_id: int) -> DataPackage:
    with open_database() as connection:
        rows = _query_packages(connection, ["p.id = ?"], [data_package_id])
        if not rows:
            raise HTTPException(status_code=404, detail="数据包不存在")
        return _package_from_row(connection, rows[0], include_files=True)


def _association_count(connection: sqlite3.Connection, table: str, package_id: int) -> int:
    """后续测试组和执行记录表落地后自动计入影响范围，当前无关联返回零。"""
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if table not in tables:
        return 0
    columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
    if "data_package_id" not in columns:
        return 0
    return connection.execute(f"SELECT COUNT(*) FROM {table} WHERE data_package_id = ?", (package_id,)).fetchone()[0]


def _test_group_assignment_counts(connection: sqlite3.Connection, package_id: int) -> tuple[int, int]:
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "test_group_data_package_assignments" not in tables:
        return (0, 0)
    row = connection.execute(
        """
        SELECT COUNT(DISTINCT test_group_id), COUNT(DISTINCT automation_test_case_id)
        FROM test_group_data_package_assignments WHERE data_package_id = ?
        """,
        (package_id,),
    ).fetchone()
    return (row[0], row[1])


@router.get("/{data_package_id}/deletion-impact", response_model=DataPackageDeletionImpact)
def get_data_package_deletion_impact(data_package_id: int) -> DataPackageDeletionImpact:
    with open_database() as connection:
        row = connection.execute("SELECT id FROM data_packages WHERE id = ?", (data_package_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="数据包不存在")
        test_group_count, automation_case_count = _test_group_assignment_counts(connection, data_package_id)
        counts = {
            "test_groups": test_group_count,
            "automation_test_cases": automation_case_count,
            "automation_execution_records": _association_count(
                connection, "automation_execution_data_packages", data_package_id
            ),
        }
    return DataPackageDeletionImpact(
        data_package_id=data_package_id,
        package_number=f"DP-{data_package_id:06d}",
        association_counts=counts,
        total_associations=sum(counts.values()),
    )


@router.delete("/{data_package_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_data_package(data_package_id: int, confirm: bool = False) -> Response:
    if not confirm:
        raise HTTPException(status_code=400, detail="请先查看数据包关联影响范围并确认删除")
    with open_database() as connection:
        row = connection.execute("SELECT id FROM data_packages WHERE id = ?", (data_package_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="数据包不存在")
        connection.execute("DELETE FROM data_packages WHERE id = ?", (data_package_id,))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
