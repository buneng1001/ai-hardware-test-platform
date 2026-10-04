from datetime import datetime
from typing import Literal

from pydantic import BaseModel

PreparationAction = Literal["edit_group", "replace_data_packages"]
AutomationExecutionStatus = Literal["pending", "running", "completed", "failed", "cancelled", "interrupted"]
AutomationCaseResultStatus = Literal["passed", "failed", "blocked", "not_executed"]


class PreparationCheck(BaseModel):
    code: str
    object_type: Literal["test_group", "automation_test_case", "data_package"]
    object_id: int
    actual: str
    expected: str
    suggestion: str
    action: PreparationAction


class AutomationExecutionPreparation(BaseModel):
    test_group_id: int
    passed: bool
    checks: list[PreparationCheck]


class AutomationExecutionCaseResult(BaseModel):
    automation_test_case_id: int
    case_number: str
    title: str
    position: int
    status: AutomationCaseResultStatus
    message: str
    case_snapshot: dict[str, object]


class AutomationExecutionSummary(BaseModel):
    passed: int
    failed: int
    blocked: int
    not_executed: int


class AutomationExecutionRecord(BaseModel):
    id: int
    test_group_id: int
    product_version_id: int
    execution_number: int
    status: AutomationExecutionStatus
    execution_mode: Literal["data_driven_simulation"]
    group_snapshot: dict[str, object]
    configuration_snapshot: dict[str, object]
    summary: AutomationExecutionSummary
    started_at: datetime
    completed_at: datetime | None
    case_results: list[AutomationExecutionCaseResult]


class AutomationExecutionPage(BaseModel):
    items: list[AutomationExecutionRecord]
