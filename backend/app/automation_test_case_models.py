from typing import Literal

from pydantic import BaseModel


class AutomationTestCase(BaseModel):
    id: int
    product_version_id: int
    source_test_case_id: int
    source_case_number: str
    case_number: str
    title: str
    input: str
    steps: str
    expected_result: str
    conversion_status: Literal["candidate", "failed"]
    confidence: Literal["low"]
    review_note: str
    created_at: str


class AutomationTestCaseList(BaseModel):
    items: list[AutomationTestCase]


class AutomationCaseConversionBatch(BaseModel):
    created_count: int
    items: list[AutomationTestCase]
