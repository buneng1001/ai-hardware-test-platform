import json
import sqlite3
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from app.database import open_database
from app.manual_attachments import AttachmentCommand, get_manual_attachment_path, save_manual_attachment
from app.run_models import ManualCheckResult

router = APIRouter(prefix="/api/runs/{run_id}/manual-check-results", tags=["manual check results"])


class ManualCheckResultCommand(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    status: Literal["passed", "failed", "blocked", "not_run"]
    actual_result: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)
    executed_at: datetime | None = None
    attachment: AttachmentCommand | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized_name = value.strip()
        if not normalized_name:
            raise ValueError("人工检查项名称不能为空")
        return normalized_name


def result_from_row(row: sqlite3.Row) -> ManualCheckResult:
    values = dict(row)
    values["attachment"] = json.loads(values["attachment"]) if values["attachment"] else None
    return ManualCheckResult.model_validate(values)


def list_manual_results(run_id: int) -> list[ManualCheckResult]:
    with open_database() as connection:
        rows = connection.execute(
            "SELECT * FROM manual_check_results WHERE run_id = ? ORDER BY id",
            (run_id,),
        ).fetchall()
    return [result_from_row(row) for row in rows]


@router.post("", response_model=ManualCheckResult, status_code=status.HTTP_201_CREATED)
def create_manual_result(run_id: int, command: ManualCheckResultCommand) -> ManualCheckResult:
    now = datetime.now(UTC).isoformat()
    with open_database() as connection:
        run = connection.execute("SELECT id FROM runs WHERE id = ?", (run_id,)).fetchone()
        if run is None:
            raise HTTPException(status_code=404, detail="运行记录不存在")
        cursor = connection.execute(
            """
            INSERT INTO manual_check_results (
                run_id, name, status, actual_result, notes, executed_at, attachment, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
            """,
            (
                run_id,
                command.name,
                command.status,
                command.actual_result,
                command.notes,
                command.executed_at.isoformat() if command.executed_at else None,
                now,
                now,
            ),
        )
        if cursor.lastrowid is None:
            raise HTTPException(status_code=500, detail="人工检查结果保存失败")
        if command.attachment:
            attachment = save_manual_attachment(run_id, cursor.lastrowid, command.attachment)
            connection.execute(
                "UPDATE manual_check_results SET attachment = ? WHERE id = ?",
                (json.dumps(attachment), cursor.lastrowid),
            )
        row = connection.execute("SELECT * FROM manual_check_results WHERE id = ?", (cursor.lastrowid,)).fetchone()

    if row is None:
        raise HTTPException(status_code=500, detail="人工检查结果保存失败")
    return result_from_row(row)


@router.put("/{result_id}", response_model=ManualCheckResult)
def update_manual_result(run_id: int, result_id: int, command: ManualCheckResultCommand) -> ManualCheckResult:
    now = datetime.now(UTC).isoformat()
    with open_database() as connection:
        existing = connection.execute(
            "SELECT id, attachment FROM manual_check_results WHERE id = ? AND run_id = ?",
            (result_id, run_id),
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="人工检查结果不存在")

    attachment = (
        save_manual_attachment(run_id, result_id, command.attachment)
        if command.attachment
        else json.loads(existing["attachment"])
        if existing["attachment"]
        else None
    )
    with open_database() as connection:
        connection.execute(
            """
            UPDATE manual_check_results
            SET name = ?, status = ?, actual_result = ?, notes = ?, executed_at = ?, attachment = ?, updated_at = ?
            WHERE id = ? AND run_id = ?
            """,
            (
                command.name,
                command.status,
                command.actual_result,
                command.notes,
                command.executed_at.isoformat() if command.executed_at else None,
                json.dumps(attachment) if attachment else None,
                now,
                result_id,
                run_id,
            ),
        )
        row = connection.execute("SELECT * FROM manual_check_results WHERE id = ?", (result_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=500, detail="人工检查结果更新失败")
    return result_from_row(row)


@router.get("/{result_id}/attachment", response_class=FileResponse)
def download_manual_attachment(run_id: int, result_id: int) -> FileResponse:
    with open_database() as connection:
        row = connection.execute(
            "SELECT attachment FROM manual_check_results WHERE id = ? AND run_id = ?",
            (result_id, run_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="人工检查结果不存在")
    if not row["attachment"]:
        raise HTTPException(status_code=404, detail="人工检查结果没有附件")

    metadata = json.loads(row["attachment"])
    path = get_manual_attachment_path(run_id, result_id, metadata["filename"])
    if not path.is_file():
        raise HTTPException(status_code=404, detail="人工检查附件不存在")
    return FileResponse(path, media_type=metadata["content_type"], filename=metadata["filename"])
