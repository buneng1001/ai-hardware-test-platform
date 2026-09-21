from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class ProjectTrend(BaseModel):
    project_id: int
    status: Literal["empty"]
    message: str
    points: list[dict[str, object]]
