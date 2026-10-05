from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.manual_attachments import AttachmentCommand

ManualTestStatus = Literal["passed", "failed", "blocked", "not_executed"]


class ManualTestResultCommand(BaseModel):
    source_test_case_id: int
    status: ManualTestStatus
    actual_result: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)
    executed_at: datetime | None = None
    attachments: list[AttachmentCommand] = Field(default_factory=list, max_length=10)


class ManualTestResultSave(BaseModel):
    results: list[ManualTestResultCommand] = Field(min_length=1, max_length=1000)


class ManualTestAttachment(BaseModel):
    id: int
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    storage_status: Literal["stored", "cleaned"]
    usage_status: Literal["unused", "used"]


class ManualTestResult(BaseModel):
    id: int
    source_test_case_id: int
    status: ManualTestStatus
    actual_result: str | None
    notes: str | None
    executed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    attachments: list[ManualTestAttachment]


class ManualTestResultReportInput(BaseModel):
    result_id: int | None
    source_test_case_id: int
    status: ManualTestStatus
    actual_result: str | None
    notes: str | None
    executed_at: datetime | None


class ManualTestResultBatch(BaseModel):
    id: int
    test_group_id: int
    product_version_id: int
    batch_number: int
    created_at: datetime
    updated_at: datetime
    results: list[ManualTestResult]
    report_input: list[ManualTestResultReportInput]


class ManualTestCase(BaseModel):
    id: int
    case_number: str
    title: str
    test_type: str
    position: int


class ManualTestResultBatchPage(BaseModel):
    test_group_id: int
    product_version_id: int
    cases: list[ManualTestCase]
    batches: list[ManualTestResultBatch]
