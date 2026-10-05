"""在线报告生命周期、附件清理和报告历史接口。"""

import sqlite3
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.database import open_database
from app.fact_report_models import (
    ReportAttachment,
    ReportAttachmentCleanupImpact,
    ReportAttachmentSummary,
    ReportHistoryItem,
    ReportHistoryPage,
)
from app.manual_test_result_attachments import delete_attachment_file
from app.test_group_queries import get_group_row

router = APIRouter(tags=["report lifecycle"])


def attachment_summary(connection: sqlite3.Connection, report_id: int) -> ReportAttachmentSummary:
    rows = connection.execute(
        """
        SELECT usage.attachment_id AS id, usage.filename, usage.content_type, usage.size_bytes,
               COALESCE(attachment.storage_status, 'cleaned') AS storage_status
        FROM report_attachment_usages usage
        LEFT JOIN manual_test_result_attachments attachment ON attachment.id = usage.attachment_id
        WHERE usage.report_id = ?
        ORDER BY usage.rowid
        """,
        (report_id,),
    ).fetchall()
    attachments = [ReportAttachment.model_validate(dict(row)) for row in rows]
    return ReportAttachmentSummary(
        attachment_count=len(attachments),
        total_size_bytes=sum(item.size_bytes for item in attachments),
        attachments=attachments,
    )


def record_attachment_usage(connection: sqlite3.Connection, report_id: int, manual_batch_ids: list[int]) -> None:
    if not manual_batch_ids:
        return
    placeholders = ", ".join("?" for _ in manual_batch_ids)
    rows = connection.execute(
        f"""
        SELECT attachment.id, attachment.filename, attachment.content_type, attachment.size_bytes
        FROM manual_test_result_attachments attachment
        JOIN manual_test_results result ON result.id = attachment.manual_test_result_id
        WHERE result.manual_test_result_batch_id IN ({placeholders})
        ORDER BY attachment.id
        """,
        manual_batch_ids,
    ).fetchall()
    connection.executemany(
        """
        INSERT INTO report_attachment_usages (report_id, attachment_id, filename, content_type, size_bytes)
        VALUES (?, ?, ?, ?, ?)
        """,
        [(report_id, row["id"], row["filename"], row["content_type"], row["size_bytes"]) for row in rows],
    )
    if rows:
        connection.executemany(
            "UPDATE manual_test_result_attachments SET usage_status = 'used' WHERE id = ?",
            [(row["id"],) for row in rows],
        )


def _get_report(connection: sqlite3.Connection, report_id: int) -> sqlite3.Row:
    report = connection.execute("SELECT * FROM online_reports WHERE id = ?", (report_id,)).fetchone()
    if report is None:
        raise HTTPException(status_code=404, detail="事实报告不存在")
    return report


def _non_superseded_report(connection: sqlite3.Connection, report_id: int) -> sqlite3.Row:
    report = _get_report(connection, report_id)
    if report["lifecycle_status"] == "superseded":
        raise HTTPException(status_code=409, detail="只能清理当前在线报告已使用的附件")
    return report


@router.get(
    "/api/fact-reports/{report_id}/attachment-cleanup-impact",
    response_model=ReportAttachmentCleanupImpact,
)
def get_attachment_cleanup_impact(report_id: int) -> ReportAttachmentCleanupImpact:
    with open_database() as connection:
        _non_superseded_report(connection, report_id)
        summary = attachment_summary(connection, report_id)
        return ReportAttachmentCleanupImpact(
            **summary.model_dump(),
            report_id=report_id,
            message="确认后将仅清理当前报告已使用附件的原始文件；人工文字结果和附件名称会保留。",
        )


@router.delete("/api/fact-reports/{report_id}/used-attachments", status_code=status.HTTP_204_NO_CONTENT)
def cleanup_used_attachments(report_id: int, confirm: bool = Query(default=False)) -> Response:
    if not confirm:
        raise HTTPException(status_code=422, detail="请先确认附件清理影响")
    with open_database() as connection:
        _non_superseded_report(connection, report_id)
        rows = connection.execute(
            """
            SELECT attachment.id, attachment.filename
            FROM report_attachment_usages usage
            JOIN manual_test_result_attachments attachment ON attachment.id = usage.attachment_id
            WHERE usage.report_id = ? AND attachment.storage_status = 'stored'
            """,
            (report_id,),
        ).fetchall()
        for attachment in rows:
            delete_attachment_file(attachment["id"], attachment["filename"])
        connection.executemany(
            "UPDATE manual_test_result_attachments SET storage_status = 'cleaned' WHERE id = ?",
            [(item["id"],) for item in rows],
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/api/fact-reports/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fact_report(report_id: int) -> Response:
    with open_database() as connection:
        _get_report(connection, report_id)
        connection.execute("DELETE FROM online_reports WHERE id = ?", (report_id,))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/test-groups/{group_id}/report-history", response_model=ReportHistoryPage)
def get_report_history(group_id: int, query: str = Query(default="", max_length=100)) -> ReportHistoryPage:
    with open_database() as connection:
        get_group_row(connection, group_id)
        items = [
            ReportHistoryItem(
                record_type="automation_execution",
                id=row["id"],
                label=f"自动化执行 #{row['execution_number']}",
                status=row["status"],
                occurred_at=datetime.fromisoformat(row["completed_at"] or row["started_at"]),
            )
            for row in connection.execute(
                """SELECT id, execution_number, status, started_at, completed_at
                   FROM automation_execution_records WHERE test_group_id = ?""",
                (group_id,),
            ).fetchall()
        ]
        items.extend(
            ReportHistoryItem(
                record_type="manual_result",
                id=row["id"],
                label=f"人工记录批次 #{row['batch_number']}",
                status="recorded",
                occurred_at=datetime.fromisoformat(row["updated_at"]),
            )
            for row in connection.execute(
                "SELECT id, batch_number, updated_at FROM manual_test_result_batches WHERE test_group_id = ?",
                (group_id,),
            ).fetchall()
        )
        items.extend(
            ReportHistoryItem(
                record_type="fact_report",
                id=row["id"],
                label=f"最终报告 #{row['id']}",
                status=row["lifecycle_status"],
                occurred_at=datetime.fromisoformat(row["created_at"]),
            )
            for row in connection.execute(
                "SELECT id, lifecycle_status, created_at FROM online_reports WHERE test_group_id = ?", (group_id,)
            ).fetchall()
        )
    term = query.strip().lower()
    if term:
        items = [item for item in items if term in item.label.lower() or term in item.status.lower()]
    return ReportHistoryPage(items=sorted(items, key=lambda item: item.occurred_at, reverse=True))
