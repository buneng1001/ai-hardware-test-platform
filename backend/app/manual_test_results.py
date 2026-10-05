"""测试组范围内可分批保存的人工测试结果。"""

import json
import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response, status

from app.database import open_database
from app.manual_test_result_attachments import delete_attachment_file, record_staleness, save_attachment
from app.manual_test_result_models import (
    ManualTestAttachment,
    ManualTestCase,
    ManualTestResult,
    ManualTestResultBatch,
    ManualTestResultBatchPage,
    ManualTestResultReportInput,
    ManualTestResultSave,
)
from app.test_group_queries import get_group_row

router = APIRouter(tags=["manual test results"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _manual_cases(connection: sqlite3.Connection, group_id: int) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT source.*, item.position
        FROM test_group_source_cases item
        JOIN source_test_cases source ON source.id = item.source_test_case_id
        WHERE item.test_group_id = ?
          AND lower(trim(source.test_type)) IN ('manual', 'mixed', '人工', '混合')
        ORDER BY item.position, source.id
        """,
        (group_id,),
    ).fetchall()


def _attachment_from_row(row: sqlite3.Row) -> ManualTestAttachment:
    return ManualTestAttachment.model_validate(dict(row))


def _result_from_row(connection: sqlite3.Connection, row: sqlite3.Row) -> ManualTestResult:
    attachments = connection.execute(
        "SELECT * FROM manual_test_result_attachments WHERE manual_test_result_id = ? ORDER BY id",
        (row["id"],),
    ).fetchall()
    values = dict(row)
    values["attachments"] = [_attachment_from_row(item) for item in attachments]
    return ManualTestResult.model_validate(values)


def _batch_from_row(connection: sqlite3.Connection, row: sqlite3.Row) -> ManualTestResultBatch:
    results = connection.execute(
        "SELECT * FROM manual_test_results WHERE manual_test_result_batch_id = ? ORDER BY id",
        (row["id"],),
    ).fetchall()
    values = dict(row)
    values["results"] = [_result_from_row(connection, item) for item in results]
    by_source_case = {item.source_test_case_id: item for item in values["results"]}
    scope = json.loads(row["scope_snapshot"])
    if not scope:
        scope = [dict(item) for item in _manual_cases(connection, row["test_group_id"])]
    scope_case_ids = {item["id"] for item in scope}
    report_input = [
        ManualTestResultReportInput(
            result_id=existing.id if (existing := by_source_case.get(item["id"])) else None,
            source_test_case_id=item["id"],
            status=existing.status if existing else "not_executed",
            actual_result=existing.actual_result if existing else None,
            notes=existing.notes if existing else None,
            executed_at=existing.executed_at if existing else None,
        )
        for item in scope
    ]
    report_input.extend(
        ManualTestResultReportInput(
            result_id=result.id,
            source_test_case_id=result.source_test_case_id,
            status=result.status,
            actual_result=result.actual_result,
            notes=result.notes,
            executed_at=result.executed_at,
        )
        for result in values["results"]
        if result.source_test_case_id not in scope_case_ids
    )
    values["report_input"] = report_input
    return ManualTestResultBatch.model_validate(values)


def _get_batch(connection: sqlite3.Connection, batch_id: int) -> sqlite3.Row:
    batch = connection.execute("SELECT * FROM manual_test_result_batches WHERE id = ?", (batch_id,)).fetchone()
    if batch is None:
        raise HTTPException(status_code=404, detail="人工测试记录批次不存在")
    return batch


def _save_results(connection: sqlite3.Connection, batch: sqlite3.Row, command: ManualTestResultSave) -> None:
    manual_case_ids = {item["id"] for item in _manual_cases(connection, batch["test_group_id"])}
    if any(item.source_test_case_id not in manual_case_ids for item in command.results):
        raise HTTPException(status_code=422, detail="人工结果只能关联当前测试组中的人工或混合用例")
    if len({item.source_test_case_id for item in command.results}) != len(command.results):
        raise HTTPException(status_code=422, detail="同一次保存不能重复同一来源用例")

    updated_result_ids: list[int] = []
    for item in command.results:
        existing = connection.execute(
            """
            SELECT id FROM manual_test_results
            WHERE manual_test_result_batch_id = ? AND source_test_case_id = ?
            """,
            (batch["id"], item.source_test_case_id),
        ).fetchone()
        now = _now()
        if existing is None:
            result_id = connection.execute(
                """
                INSERT INTO manual_test_results
                    (manual_test_result_batch_id, source_test_case_id, status, actual_result, notes, executed_at,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    batch["id"],
                    item.source_test_case_id,
                    item.status,
                    item.actual_result,
                    item.notes,
                    item.executed_at.isoformat() if item.executed_at else None,
                    now,
                    now,
                ),
            ).lastrowid
        else:
            result_id = existing["id"]
            updated_result_ids.append(result_id)
            connection.execute(
                """
                UPDATE manual_test_results
                SET status = ?, actual_result = ?, notes = ?, executed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    item.status,
                    item.actual_result,
                    item.notes,
                    item.executed_at.isoformat() if item.executed_at else None,
                    now,
                    result_id,
                ),
            )
        for attachment in item.attachments:
            attachment_id = connection.execute(
                """
                INSERT INTO manual_test_result_attachments
                    (manual_test_result_id, filename, content_type, size_bytes, sha256, created_at, updated_at)
                VALUES (?, ?, ?, 0, '', ?, ?)
                """,
                (result_id, attachment.filename, attachment.content_type, now, now),
            ).lastrowid
            metadata = save_attachment(attachment_id, attachment)
            connection.execute(
                """
                UPDATE manual_test_result_attachments
                SET size_bytes = ?, sha256 = ? WHERE id = ?
                """,
                (metadata["size_bytes"], metadata["sha256"], attachment_id),
            )
    now = _now()
    connection.execute("UPDATE manual_test_result_batches SET updated_at = ? WHERE id = ?", (now, batch["id"]))
    for result_id in updated_result_ids:
        record_staleness(connection, batch, "manual_result_updated", result_id)


@router.get(
    "/api/test-groups/{group_id}/manual-test-result-batches",
    response_model=ManualTestResultBatchPage,
)
def list_manual_test_result_batches(group_id: int) -> ManualTestResultBatchPage:
    with open_database() as connection:
        group = get_group_row(connection, group_id)
        cases = _manual_cases(connection, group_id)
        batches = connection.execute(
            "SELECT * FROM manual_test_result_batches WHERE test_group_id = ? ORDER BY id DESC", (group_id,)
        ).fetchall()
        return ManualTestResultBatchPage(
            test_group_id=group_id,
            product_version_id=group["product_version_id"],
            cases=[ManualTestCase.model_validate(dict(item)) for item in cases],
            batches=[_batch_from_row(connection, item) for item in batches],
        )


@router.post(
    "/api/test-groups/{group_id}/manual-test-result-batches",
    response_model=ManualTestResultBatch,
    status_code=status.HTTP_201_CREATED,
)
def create_manual_test_result_batch(group_id: int, command: ManualTestResultSave) -> ManualTestResultBatch:
    with open_database() as connection:
        group = get_group_row(connection, group_id)
        now = _now()
        scope_snapshot = json.dumps([dict(item) for item in _manual_cases(connection, group_id)], ensure_ascii=False)
        number = connection.execute(
            "SELECT COALESCE(MAX(batch_number), 0) + 1 FROM manual_test_result_batches WHERE test_group_id = ?",
            (group_id,),
        ).fetchone()[0]
        batch_id = connection.execute(
            """
            INSERT INTO manual_test_result_batches
                (test_group_id, product_version_id, batch_number, created_at, updated_at, scope_snapshot)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (group_id, group["product_version_id"], number, now, now, scope_snapshot),
        ).lastrowid
        batch = _get_batch(connection, batch_id)
        _save_results(connection, batch, command)
        return _batch_from_row(connection, _get_batch(connection, batch_id))


@router.put("/api/manual-test-result-batches/{batch_id}", response_model=ManualTestResultBatch)
def save_manual_test_result_batch(batch_id: int, command: ManualTestResultSave) -> ManualTestResultBatch:
    with open_database() as connection:
        batch = _get_batch(connection, batch_id)
        _save_results(connection, batch, command)
        return _batch_from_row(connection, _get_batch(connection, batch_id))


@router.delete("/api/manual-test-results/{result_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_manual_test_result(result_id: int) -> Response:
    with open_database() as connection:
        row = connection.execute(
            """
            SELECT result.*, batch.test_group_id, batch.product_version_id
            FROM manual_test_results result
            JOIN manual_test_result_batches batch ON batch.id = result.manual_test_result_batch_id
            WHERE result.id = ?
            """,
            (result_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="人工测试结果不存在")
        attachments = connection.execute(
            "SELECT id, filename FROM manual_test_result_attachments WHERE manual_test_result_id = ?", (result_id,)
        ).fetchall()
        for attachment in attachments:
            delete_attachment_file(attachment["id"], attachment["filename"])
        connection.execute("DELETE FROM manual_test_results WHERE id = ?", (result_id,))
        record_staleness(connection, row, "manual_result_deleted", result_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
