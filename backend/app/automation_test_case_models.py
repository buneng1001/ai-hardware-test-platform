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


class AutomationCaseAiDecision(BaseModel):
    """模型对单条原始用例的判定结果。"""

    source_case_id: int
    case_number: str
    title: str
    decision: Literal["automation", "manual"]
    reason: str
    # 判定依据：用什么信号、数据从哪来、卡在哪条门槛。
    expected_signal: str = ""
    data_source: str = ""
    blocker: str = "none"
    # 模型给出的可执行预期结果，用于提前检查是否可断言。
    expected_result: str = ""
    confidence: str = "medium"


class AutomationCaseAiConversionBatch(BaseModel):
    automation_count: int
    manual_count: int
    created_count: int
    updated_count: int = 0
    removed_count: int = 0
    decisions: list[AutomationCaseAiDecision]
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
