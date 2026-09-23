import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status

from app.automation_test_case_models import (
    AutomationCaseConversionBatch,
    AutomationTestCase,
    AutomationTestCaseList,
)
from app.case_services import AutomationCaseConversionResult, AutomationCaseConversionService
from app.database import open_database

router = APIRouter(tags=["automation test cases"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _ensure_version(connection: sqlite3.Connection, version_id: int) -> None:
    if connection.execute("SELECT 1 FROM product_versions WHERE id = ?", (version_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="产品版本不存在")


def _list_cases(connection: sqlite3.Connection, version_id: int) -> list[AutomationTestCase]:
    rows = connection.execute(
        """
        SELECT automation.*, source.case_number AS source_case_number
        FROM automation_test_cases automation
        JOIN source_test_cases source ON source.id = automation.source_test_case_id
        WHERE automation.product_version_id = ?
        ORDER BY automation.id
        """,
        (version_id,),
    ).fetchall()
    return [AutomationTestCase(**dict(row)) for row in rows]


@router.get("/api/product-versions/{version_id}/automation-test-cases", response_model=AutomationTestCaseList)
def list_automation_test_cases(version_id: int) -> AutomationTestCaseList:
    with open_database() as connection:
        _ensure_version(connection, version_id)
        return AutomationTestCaseList(items=_list_cases(connection, version_id))


@router.post(
    "/api/product-versions/{version_id}/automation-test-case-conversions/rules",
    response_model=AutomationCaseConversionBatch,
    status_code=status.HTTP_201_CREATED,
)
def convert_source_cases_with_rules(version_id: int) -> AutomationCaseConversionBatch:
    """为尚未生成候选的原始用例批量创建独立的离线规则候选。"""
    service = AutomationCaseConversionService()
    created_count = 0
    with open_database() as connection:
        _ensure_version(connection, version_id)
        source_cases = connection.execute(
            """
            SELECT source.*
            FROM source_test_cases source
            LEFT JOIN automation_test_cases automation ON automation.source_test_case_id = source.id
            WHERE source.product_version_id = ? AND automation.id IS NULL
            ORDER BY source.id
            """,
            (version_id,),
        ).fetchall()
        for source_case in source_cases:
            source_values = dict(source_case)
            try:
                result = service.convert(source_values)
            except Exception:
                result = AutomationCaseConversionResult(status="failed", confidence="low", review_note="规则转换失败")
            cursor = connection.execute(
                """
                INSERT INTO automation_test_cases
                    (product_version_id, source_test_case_id, conversion_status, confidence, review_note,
                     title, input, steps, expected_result, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    version_id,
                    source_values["id"],
                    result.status,
                    result.confidence,
                    result.review_note,
                    result.title,
                    result.input,
                    result.steps,
                    result.expected_result,
                    _now(),
                ),
            )
            connection.execute(
                "UPDATE automation_test_cases SET case_number = ? WHERE id = ?",
                (f"AUTO-{cursor.lastrowid:06d}", cursor.lastrowid),
            )
            created_count += 1
        if created_count:
            connection.execute(
                "UPDATE projects SET updated_at = ? WHERE id = (SELECT project_id FROM product_versions WHERE id = ?)",
                (_now(), version_id),
            )
        items = _list_cases(connection, version_id)
    return AutomationCaseConversionBatch(created_count=created_count, items=items)
