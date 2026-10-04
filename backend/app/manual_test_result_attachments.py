import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response, status
from fastapi.responses import FileResponse

from app.database import get_data_dir, open_database
from app.manual_attachments import AttachmentCommand, attachment_metadata, decode_attachment

router = APIRouter(tags=["manual test result attachments"])


def save_attachment(attachment_id: int, command: AttachmentCommand) -> dict[str, str | int]:
    content = decode_attachment(command)
    directory = get_data_dir() / "manual-test-attachments"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{attachment_id}-{command.filename}").write_bytes(content)
    return attachment_metadata(command, content)


def attachment_path(attachment_id: int, filename: str) -> Path:
    return get_data_dir() / "manual-test-attachments" / f"{attachment_id}-{filename}"


def delete_attachment_file(attachment_id: int, filename: str) -> None:
    attachment_path(attachment_id, filename).unlink(missing_ok=True)


def record_staleness(connection: sqlite3.Connection, batch: sqlite3.Row, event_type: str, source_id: int) -> None:
    connection.execute(
        """
        INSERT INTO report_staleness_events
            (test_group_id, product_version_id, event_type, source_type, source_id, created_at)
        VALUES (?, ?, ?, 'manual_test_result', ?, ?)
        """,
        (batch["test_group_id"], batch["product_version_id"], event_type, source_id, datetime.now(UTC).isoformat()),
    )


@router.get("/api/manual-test-attachments/{attachment_id}/download", response_class=FileResponse)
def download_manual_test_attachment(attachment_id: int) -> FileResponse:
    with open_database() as connection:
        attachment = connection.execute(
            "SELECT * FROM manual_test_result_attachments WHERE id = ?", (attachment_id,)
        ).fetchone()
    if attachment is None or attachment["storage_status"] != "stored":
        raise HTTPException(status_code=404, detail="人工测试附件不存在")
    path = attachment_path(attachment_id, attachment["filename"])
    if not path.is_file():
        raise HTTPException(status_code=404, detail="人工测试附件不存在")
    return FileResponse(path, media_type=attachment["content_type"], filename=attachment["filename"])


@router.delete("/api/manual-test-attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_manual_test_attachment(attachment_id: int) -> Response:
    with open_database() as connection:
        attachment = connection.execute(
            """
            SELECT attachment.*, result.manual_test_result_batch_id, batch.test_group_id, batch.product_version_id
            FROM manual_test_result_attachments attachment
            JOIN manual_test_results result ON result.id = attachment.manual_test_result_id
            JOIN manual_test_result_batches batch ON batch.id = result.manual_test_result_batch_id
            WHERE attachment.id = ?
            """,
            (attachment_id,),
        ).fetchone()
        if attachment is None:
            raise HTTPException(status_code=404, detail="人工测试附件不存在")
        delete_attachment_file(attachment_id, attachment["filename"])
        connection.execute("DELETE FROM manual_test_result_attachments WHERE id = ?", (attachment_id,))
        record_staleness(connection, attachment, "manual_result_updated", attachment["manual_test_result_batch_id"])
    return Response(status_code=status.HTTP_204_NO_CONTENT)
