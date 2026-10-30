"""规则式自动化用例转换 API；按用例行语义批次处理。"""

from fastapi import APIRouter, HTTPException, status

from app.ai_batching import batch_config
from app.automation_case_history import record_automation_case_history
from app.automation_test_case_models import AutomationCaseConversionBatch
from app.automation_test_cases import (
    _assign_case_number_and_get,
    _ensure_version,
    _list_cases,
    _now,
    _touch_project,
)
from app.case_services import (
    AutomationCaseConversionResult,
    AutomationCaseConversionService,
)
from app.database import open_database

router = APIRouter(tags=["automation test cases"])


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
        case_batch_size = batch_config().cases_per_batch
        for batch_start in range(0, len(source_cases), case_batch_size):
            batch = source_cases[batch_start : batch_start + case_batch_size]
            for source_case in batch:
                source_values = dict(source_case)
                try:
                    result = service.convert(source_values)
                except Exception:
                    result = AutomationCaseConversionResult(
                        status="failed", confidence="low", review_note="规则转换失败"
                    )
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
