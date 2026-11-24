from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class FactReportCreate(BaseModel):
    automation_execution_id: int | None = Field(default=None, gt=0)
    manual_batch_ids: list[int] = Field(default_factory=list, max_length=100)
    historical_report_ids: list[int] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def require_selected_record(self):
        if self.automation_execution_id is None and not self.manual_batch_ids and not self.historical_report_ids:
            raise ValueError("至少选择一份有效的自动化、人工或历史最终报告来源")
        if len(set(self.manual_batch_ids)) != len(self.manual_batch_ids):
            raise ValueError("人工测试记录不能重复选择")
        if any(item <= 0 for item in self.manual_batch_ids):
            raise ValueError("人工测试记录编号必须为正整数")
        if len(set(self.historical_report_ids)) != len(self.historical_report_ids):
            raise ValueError("历史最终报告不能重复选择")
        if any(item <= 0 for item in self.historical_report_ids):
            raise ValueError("历史最终报告编号必须为正整数")
        return self


class HistoricalReportOption(BaseModel):
    id: int
    product_version: str
    test_group: str
    created_at: datetime
    overall: dict[str, object]


class HistoricalReportOptions(BaseModel):
    items: list[HistoricalReportOption]


class RegressionAuxiliarySelection(BaseModel):
    report_ids: list[int] = Field(default_factory=list, max_length=100)


class RegressionAuxiliaryReportOption(BaseModel):
    id: int
    product_version: str
    test_group: str
    created_at: datetime
    analysis_status: str


class RegressionAuxiliaryReportOptions(BaseModel):
    items: list[RegressionAuxiliaryReportOption]


class ReportAnalysisItem(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    evidence_refs: list[str] = Field(min_length=1, max_length=20)


class ReportStageRecommendation(ReportAnalysisItem):
    suggestion: str = Field(min_length=1, max_length=300)


TestAnalysisDimension = Literal[
    "functional",
    "performance",
    "integration",
    "compatibility",
    "interaction",
    "reliability",
    "security",
    "maintainability",
    "flexibility",
    "safety",
    "environment",
    "data_quality",
]


class ReportTestDirection(BaseModel):
    dimension: TestAnalysisDimension
    priority: Literal["high", "medium", "low"]
    title: str = Field(min_length=1, max_length=80)
    coverage_gap: str = Field(min_length=1, max_length=350)
    risk: str = Field(min_length=1, max_length=350)
    direction: str = Field(min_length=1, max_length=350)
    evidence_refs: list[str] = Field(min_length=1, max_length=20)


class ProfessionalReportAnalysisOutput(BaseModel):
    """新版模型契约，不重复生成风险与补测两份列表。"""

    stage_recommendation: ReportStageRecommendation
    test_directions: list[ReportTestDirection] = Field(max_length=20)
    regression_recommendations: list[ReportAnalysisItem] = Field(max_length=20)


class ReportAnalysisOutput(BaseModel):
    risks: list[ReportAnalysisItem] = Field(max_length=20)
    additional_verifications: list[ReportAnalysisItem] = Field(max_length=20)
    regression_recommendations: list[ReportAnalysisItem] = Field(max_length=20)
    stage_recommendation: ReportStageRecommendation
    # None 表示历史 V1–V3；新版保留结构化方向。
    test_directions: list[ReportTestDirection] | None = None


class ReportAnalysis(BaseModel):
    status: str
    message: str
    output: ReportAnalysisOutput | None
    error: dict[str, object] | None = None
    run_id: int | None = None
    fingerprint: str | None = None
    stage: str | None = None
    elapsed_ms: int | None = None
    reused: bool = False
    stopping: bool = False


class FactReport(BaseModel):
    id: int
    test_group_id: int
    product_version_id: int
    automation_execution_id: int | None
    manual_batch_ids: list[int]
    snapshot: dict[str, object]
    historical_report_ids: list[int] = Field(default_factory=list)
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
