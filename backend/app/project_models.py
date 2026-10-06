from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ProjectCreate(BaseModel):
    name: str = Field(max_length=120)
    product_name: str = Field(max_length=120)
    description: str = Field(default="", max_length=1000)

    @field_validator("name", "product_name")
    @classmethod
    def require_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("项目名称和产品名称不能为空")
        return normalized

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        return value.strip()


class ProductVersionCreate(BaseModel):
    version: str = Field(max_length=80)
    name: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=1000)

    @field_validator("version")
    @classmethod
    def require_version(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("版本号不能为空")
        return normalized

    @field_validator("name", "description")
    @classmethod
    def normalize_optional_text(cls, value: str) -> str:
        return value.strip()


class ProductVersionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str | None = Field(default=None, max_length=80)
    name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=1000)

    @field_validator("version")
    @classmethod
    def require_version_when_present(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("版本号不能为空")
        return normalized

    @field_validator("name", "description")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class ProductVersion(BaseModel):
    id: int
    project_id: int
    version: str
    name: str
    description: str
    created_at: str
    updated_at: str


class ProjectSummary(BaseModel):
    id: int
    name: str
    product_name: str
    description: str
    product_version_count: int
    created_at: str
    updated_at: str


class ProjectDetail(ProjectSummary):
    product_versions: list[ProductVersion]


class VersionImpactItem(BaseModel):
    id: int
    version: str
    name: str


class ProjectDeletionImpact(BaseModel):
    project_id: int
    product_versions: list[VersionImpactItem]
    asset_counts: dict[str, int]
    total_affected_assets: int


class ProductVersionDeletionImpact(BaseModel):
    product_version: VersionImpactItem
    asset_counts: dict[str, int]
    total_affected_assets: int


class ResultCounts(BaseModel):
    passed: int = 0
    failed: int = 0
    blocked: int = 0
    not_executed: int = 0


class ResultSourceCounts(BaseModel):
    automation: ResultCounts = Field(default_factory=ResultCounts)
    manual: ResultCounts = Field(default_factory=ResultCounts)


class TrendModule(BaseModel):
    name: str
    conclusion: str
    counts: ResultSourceCounts


class ProjectTrendPoint(BaseModel):
    report_id: int
    product_version_id: int
    product_version: str
    test_group_id: int
    test_group: str
    created_at: str
    lifecycle_status: Literal["current", "stale", "superseded"]
    counts: ResultSourceCounts
    modules: list[TrendModule]


class ProjectTrend(BaseModel):
    project_id: int
    status: Literal["empty", "filtered_empty", "single", "ready"]
    message: str
    points: list[ProjectTrendPoint]


class ReportComparisonRequest(BaseModel):
    left_report_id: int | None = Field(default=None, gt=0)
    right_report_id: int | None = Field(default=None, gt=0)
    left_product_version_id: int | None = Field(default=None, gt=0)
    right_product_version_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def require_one_comparison_kind(self):
        report_pair = (self.left_report_id, self.right_report_id)
        version_pair = (self.left_product_version_id, self.right_product_version_id)
        reports_selected = all(report_pair) and not any(version_pair)
        versions_selected = all(version_pair) and not any(report_pair)
        if not (reports_selected or versions_selected):
            raise ValueError("必须主动选择两份报告，或主动选择两个产品版本")
        if report_pair[0] is not None and report_pair[0] == report_pair[1]:
            raise ValueError("比较对象不能相同")
        if version_pair[0] is not None and version_pair[0] == version_pair[1]:
            raise ValueError("比较对象不能相同")
        return self


class ComparisonTarget(BaseModel):
    kind: Literal["report", "product_version"]
    id: int
    label: str
    report_ids: list[int]


class ScopeItem(BaseModel):
    case_number: str
    title: str
    module: str
    sources: list[Literal["automation", "manual"]]


class UnalignedScopeItem(BaseModel):
    case_number: str
    left_modules: list[str]
    right_modules: list[str]


class ModuleComparison(BaseModel):
    name: str
    left: ResultSourceCounts
    right: ResultSourceCounts
    left_conclusion: str
    right_conclusion: str


class ReportComparison(BaseModel):
    project_id: int
    left: ComparisonTarget
    right: ComparisonTarget
    counts: dict[Literal["left", "right"], ResultSourceCounts]
    modules: list[ModuleComparison]
    added_modules: list[str]
    removed_modules: list[str]
    added_scope: list[ScopeItem]
    removed_scope: list[ScopeItem]
    unaligned_scope: list[UnalignedScopeItem]
    unresolved_risk_modules: list[str]
