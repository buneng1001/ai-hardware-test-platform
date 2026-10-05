from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class FactReportCreate(BaseModel):
    automation_execution_id: int | None = Field(default=None, gt=0)
    manual_batch_ids: list[int] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def require_selected_record(self):
        if self.automation_execution_id is None and not self.manual_batch_ids:
            raise ValueError("至少选择一条自动化执行记录或一条人工测试记录")
        if len(set(self.manual_batch_ids)) != len(self.manual_batch_ids):
            raise ValueError("人工测试记录不能重复选择")
        if any(item <= 0 for item in self.manual_batch_ids):
            raise ValueError("人工测试记录编号必须为正整数")
        return self


class ReportAnalysisItem(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    evidence_refs: list[str] = Field(min_length=1, max_length=20)


class ReportStageRecommendation(ReportAnalysisItem):
    suggestion: str = Field(min_length=1, max_length=300)


class ReportAnalysisOutput(BaseModel):
    risks: list[ReportAnalysisItem] = Field(max_length=20)
    additional_verifications: list[ReportAnalysisItem] = Field(max_length=20)
    regression_recommendations: list[ReportAnalysisItem] = Field(max_length=20)
    stage_recommendation: ReportStageRecommendation


class ReportAnalysis(BaseModel):
    status: str
    message: str
    output: ReportAnalysisOutput | None


class FactReport(BaseModel):
    id: int
    test_group_id: int
    product_version_id: int
    automation_execution_id: int | None
    manual_batch_ids: list[int]
    snapshot: dict[str, object]
    created_at: datetime
    analysis: ReportAnalysis
    lifecycle_status: Literal["current", "stale", "superseded"]
    attachment_summary: "ReportAttachmentSummary"


class ReportAttachment(BaseModel):
    id: int | None
    filename: str
    content_type: str
    size_bytes: int
    storage_status: Literal["stored", "cleaned"]
    usage_status: Literal["used"] = "used"


class ReportAttachmentSummary(BaseModel):
    attachment_count: int
    total_size_bytes: int
    attachments: list[ReportAttachment]


class ReportAttachmentCleanupImpact(ReportAttachmentSummary):
    report_id: int
    message: str


class ReportHistoryItem(BaseModel):
    record_type: Literal["automation_execution", "manual_result", "fact_report"]
    id: int
    label: str
    status: str
    occurred_at: datetime


class ReportHistoryPage(BaseModel):
    items: list[ReportHistoryItem]
