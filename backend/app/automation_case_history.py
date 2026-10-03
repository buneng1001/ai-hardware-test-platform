import json
import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from app.automation_test_case_models import (
    AutomationCaseHistory,
    AutomationCaseHistoryEntry,
    AutomationTestCase,
)
from app.database import open_database

router = APIRouter(tags=["automation test case history"])


def record_automation_case_history(
    connection: sqlite3.Connection, case: AutomationTestCase, event_type: str, **extra: object
) -> None:
    """为当前可编辑资产保存不可变快照，删除资产后仍保留其审计记录。"""
    values = case.model_dump(mode="json")
    values.update(extra)
    connection.execute(
        """
        INSERT INTO automation_test_case_history
            (product_version_id, automation_test_case_id, event_type, snapshot, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            case.product_version_id,
            case.id,
            event_type,
            json.dumps(values, ensure_ascii=False, sort_keys=True),
            datetime.now(UTC).isoformat(),
        ),
    )


@router.get(
    "/api/product-versions/{version_id}/automation-test-cases/{case_id}/history", response_model=AutomationCaseHistory
)
def get_automation_case_history(version_id: int, case_id: int) -> AutomationCaseHistory:
    with open_database() as connection:
        if connection.execute("SELECT 1 FROM product_versions WHERE id = ?", (version_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="产品版本不存在")
        rows = connection.execute(
            "SELECT id, event_type, snapshot, created_at FROM automation_test_case_history "
            "WHERE product_version_id = ? AND automation_test_case_id = ? ORDER BY id",
            (version_id, case_id),
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="自动化用例历史不存在")
        snapshots = [json.loads(row["snapshot"]) for row in rows]
        source = connection.execute(
            "SELECT case_number, title, input, steps, expected_result FROM source_test_cases WHERE id = ?",
            (snapshots[0].get("source_test_case_id"),),
        ).fetchone()
    return AutomationCaseHistory(
        source={key: str(value or "") for key, value in dict(source).items()} if source else {},
        items=[
            AutomationCaseHistoryEntry(
                id=row["id"], event_type=row["event_type"], snapshot=snapshot, created_at=row["created_at"]
            )
            for row, snapshot in zip(rows, snapshots, strict=True)
        ],
    )
