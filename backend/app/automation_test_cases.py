import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response, status

from app.automation_case_history import record_automation_case_history
from app.automation_case_validation import validation_message
from app.automation_test_case_models import (
    AutomationCaseConversionBatch,
    AutomationCaseFeedbackRequest,
    AutomationCaseValidationResult,
    AutomationTestCase,
    AutomationTestCaseCreate,
    AutomationTestCaseList,
    AutomationTestCaseUpdate,
)
from app.case_services import AutomationCaseConversionResult, AutomationCaseConversionService
from app.database import open_database

router = APIRouter(tags=["automation test cases"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _ensure_version(connection: sqlite3.Connection, version_id: int) -> None:
    if connection.execute("SELECT 1 FROM product_versions WHERE id = ?", (version_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="产品版本不存在")


def _case_from_row(row: sqlite3.Row) -> AutomationTestCase:
    return AutomationTestCase(**dict(row))


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
    return [_case_from_row(row) for row in rows]


def _get_case(connection: sqlite3.Connection, version_id: int, case_id: int) -> AutomationTestCase:
    row = connection.execute(
        """
        SELECT automation.*, source.case_number AS source_case_number
        FROM automation_test_cases automation
        JOIN source_test_cases source ON source.id = automation.source_test_case_id
        WHERE automation.product_version_id = ? AND automation.id = ?
        """,
        (version_id, case_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="自动化用例不存在")
    return _case_from_row(row)


def _touch_project(connection: sqlite3.Connection, version_id: int) -> None:
    connection.execute(
        "UPDATE projects SET updated_at = ? WHERE id = (SELECT project_id FROM product_versions WHERE id = ?)",
        (_now(), version_id),
    )


def _assign_case_number_and_get(connection: sqlite3.Connection, version_id: int, case_id: int) -> AutomationTestCase:
    connection.execute(
        "UPDATE automation_test_cases SET case_number = ? WHERE id = ?",
        (f"AUTO-{case_id:06d}", case_id),
    )
    return _get_case(connection, version_id, case_id)


@router.get("/api/product-versions/{version_id}/automation-test-cases", response_model=AutomationTestCaseList)
def list_automation_test_cases(version_id: int) -> AutomationTestCaseList:
    with open_database() as connection:
        _ensure_version(connection, version_id)
        return AutomationTestCaseList(items=_list_cases(connection, version_id))


@router.post(
    "/api/product-versions/{version_id}/automation-test-cases",
    response_model=AutomationTestCase,
    status_code=status.HTTP_201_CREATED,
)
def create_automation_test_case(version_id: int, command: AutomationTestCaseCreate) -> AutomationTestCase:
    with open_database() as connection:
        _ensure_version(connection, version_id)
        sources = connection.execute(
            "SELECT id FROM source_test_cases WHERE product_version_id = ? AND case_number = ? ORDER BY id",
            (version_id, command.source_case_number),
        ).fetchall()
        if not sources:
            raise HTTPException(status_code=422, detail="来源编号必须属于当前产品版本")
        if len(sources) > 1:
            raise HTTPException(status_code=422, detail="来源编号在当前产品版本不唯一，无法新增自动化用例")
        timestamp = _now()
        cursor = connection.execute(
            """
            INSERT INTO automation_test_cases
                (product_version_id, source_test_case_id, conversion_status, confidence, review_note,
                 title, input, steps, expected_result, created_at, updated_at)
            VALUES (?, ?, 'manual', 'low', '人工新增，尚未校验。', ?, ?, ?, ?, ?, ?)
            """,
            (
                version_id,
                sources[0]["id"],
                command.title,
                command.input,
                command.steps,
                command.expected_result,
                timestamp,
                timestamp,
            ),
        )
        case_id = cursor.lastrowid
        if case_id is None:
            raise HTTPException(status_code=500, detail="自动化用例保存失败")
        saved = _assign_case_number_and_get(connection, version_id, case_id)
        record_automation_case_history(connection, saved, "created")
        _touch_project(connection, version_id)
        return saved


@router.patch("/api/product-versions/{version_id}/automation-test-cases/{case_id}", response_model=AutomationTestCase)
def update_automation_test_case(version_id: int, case_id: int, command: AutomationTestCaseUpdate) -> AutomationTestCase:
    changes = command.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="至少提供一个需要修改的字段")
    with open_database() as connection:
        _ensure_version(connection, version_id)
        _get_case(connection, version_id, case_id)
        assignments = ", ".join(f"{field} = ?" for field in changes)
        connection.execute(
            f"UPDATE automation_test_cases SET {assignments}, validation_status = 'unvalidated', "
            "validation_message = '', updated_at = ? WHERE id = ?",
            (*changes.values(), _now(), case_id),
        )
        saved = _get_case(connection, version_id, case_id)
        record_automation_case_history(connection, saved, "edited")
        _touch_project(connection, version_id)
        return saved


@router.post(
    "/api/product-versions/{version_id}/automation-test-cases/{case_id}/regenerate",
    response_model=AutomationTestCase,
)
def regenerate_automation_test_case(version_id: int, case_id: int) -> AutomationTestCase:
    """仅在工程师明确操作时以最新原始用例重建当前候选，保留原编号和历史。"""
    with open_database() as connection:
        _ensure_version(connection, version_id)
        case = _get_case(connection, version_id, case_id)
        source = connection.execute(
            "SELECT * FROM source_test_cases WHERE id = ?", (case.source_test_case_id,)
        ).fetchone()
        if source is None:
            raise HTTPException(status_code=422, detail="来源用例不存在，无法重新生成")
        source_values = dict(source)
        try:
            result = AutomationCaseConversionService().convert(source_values)
        except Exception:
            result = AutomationCaseConversionResult(status="failed", confidence="low", review_note="规则转换失败")
        connection.execute(
            """
            UPDATE automation_test_cases
            SET conversion_status = ?, confidence = ?, review_note = ?, title = ?, input = ?, steps = ?,
                expected_result = ?, validation_status = 'unvalidated', validation_message = '', updated_at = ?
            WHERE id = ?
            """,
            (
                result.status,
                result.confidence,
                result.review_note,
                result.title,
                result.input,
                result.steps,
                result.expected_result,
                _now(),
                case_id,
            ),
        )
        saved = _get_case(connection, version_id, case_id)
        record_automation_case_history(connection, saved, "regenerated", source=source_values)
        _touch_project(connection, version_id)
        return saved


@router.delete(
    "/api/product-versions/{version_id}/automation-test-cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_automation_test_case(version_id: int, case_id: int) -> Response:
    with open_database() as connection:
        _ensure_version(connection, version_id)
        _get_case(connection, version_id, case_id)
        connection.execute("DELETE FROM automation_test_cases WHERE id = ?", (case_id,))
        _touch_project(connection, version_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/product-versions/{version_id}/automation-test-cases/validate", response_model=AutomationCaseValidationResult
)
def validate_automation_test_cases(version_id: int) -> AutomationCaseValidationResult:
    with open_database() as connection:
        _ensure_version(connection, version_id)
        for case in _list_cases(connection, version_id):
            message = validation_message(case)
            validation_status = "failed" if message else "passed"
            connection.execute(
                "UPDATE automation_test_cases SET validation_status = ?, validation_message = ?, "
                "updated_at = ? WHERE id = ?",
                (validation_status, message, _now(), case.id),
            )
            record_automation_case_history(connection, _get_case(connection, version_id, case.id), "validated")
        validated = _list_cases(connection, version_id)
    return AutomationCaseValidationResult(
        valid=all(case.validation_status == "passed" for case in validated), items=validated
    )


@router.post("/api/product-versions/{version_id}/automation-test-cases/{case_id}/feedback")
def submit_automation_case_feedback(version_id: int, case_id: int, command: AutomationCaseFeedbackRequest) -> None:
    """当前没有面向自动化用例反馈的适配器，明确拒绝且不覆盖前端草稿。"""
    with open_database() as connection:
        _ensure_version(connection, version_id)
        _get_case(connection, version_id, case_id)
        connection.execute(
            "UPDATE automation_test_cases SET feedback_input = ?, feedback_status = 'unavailable', updated_at = ? "
            "WHERE id = ?",
            (command.feedback_input, _now(), case_id),
        )
        record_automation_case_history(connection, _get_case(connection, version_id, case_id), "feedback_unavailable")
    raise HTTPException(status_code=503, detail="AI 反馈适配器不可用；已保留输入，请稍后重试或人工修改。")


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
            SELECT source.* FROM source_test_cases source
            LEFT JOIN automation_test_cases automation ON automation.source_test_case_id = source.id
            WHERE source.product_version_id = ? AND automation.id IS NULL ORDER BY source.id
            """,
            (version_id,),
        ).fetchall()
        for source_case in source_cases:
            source_values = dict(source_case)
            try:
                result = service.convert(source_values)
            except Exception:
                result = AutomationCaseConversionResult(status="failed", confidence="low", review_note="规则转换失败")
            timestamp = _now()
            cursor = connection.execute(
                """
                INSERT INTO automation_test_cases
                    (product_version_id, source_test_case_id, conversion_status, confidence, review_note,
                     title, input, steps, expected_result, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    timestamp,
                    timestamp,
                ),
            )
            case_id = cursor.lastrowid
            if case_id is None:
                raise HTTPException(status_code=500, detail="自动化用例保存失败")
            saved = _assign_case_number_and_get(connection, version_id, case_id)
            record_automation_case_history(connection, saved, "initial_conversion", source=source_values)
            created_count += 1
        if created_count:
            _touch_project(connection, version_id)
        items = _list_cases(connection, version_id)
    return AutomationCaseConversionBatch(created_count=created_count, items=items)
