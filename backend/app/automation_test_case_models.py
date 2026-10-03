from typing import Literal

from pydantic import BaseModel, Field, field_validator


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
    conversion_status: Literal["candidate", "failed", "manual"]
    confidence: Literal["low"]
    review_note: str
    validation_status: Literal["unvalidated", "passed", "failed"]
    validation_message: str
    feedback_input: str
    feedback_status: Literal["not_requested", "unavailable", "accepted"]
    feedback_response: str
    created_at: str
    updated_at: str


class AutomationTestCaseList(BaseModel):
    items: list[AutomationTestCase]


class AutomationCaseConversionBatch(BaseModel):
    created_count: int
    items: list[AutomationTestCase]


class AutomationTestCaseCreate(BaseModel):
    source_case_number: str = Field(min_length=1, max_length=120)
    title: str = Field(default="", max_length=2_000)
    input: str = Field(default="", max_length=10_000)
    steps: str = Field(default="", max_length=10_000)
    expected_result: str = Field(default="", max_length=10_000)

    @field_validator("source_case_number", "title", "input", "steps", "expected_result")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class AutomationTestCaseUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=2_000)
    input: str | None = Field(default=None, max_length=10_000)
    steps: str | None = Field(default=None, max_length=10_000)
    expected_result: str | None = Field(default=None, max_length=10_000)

    @field_validator("title", "input", "steps", "expected_result")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value


class AutomationCaseFeedbackRequest(BaseModel):
    feedback_input: str = Field(min_length=1, max_length=10_000)

    @field_validator("feedback_input")
    @classmethod
    def strip_feedback(cls, value: str) -> str:
        return value.strip()


class AutomationCaseValidationResult(BaseModel):
    valid: bool
    items: list[AutomationTestCase]


class AutomationCaseHistoryEntry(BaseModel):
    id: int
    event_type: str
    snapshot: dict[str, object]
    created_at: str


class AutomationCaseHistory(BaseModel):
    source: dict[str, str]
    items: list[AutomationCaseHistoryEntry]
