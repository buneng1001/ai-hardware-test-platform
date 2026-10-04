from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class TestGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    include_selected_source_cases: bool = True

    @field_validator("name", "description")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return value.strip()


class TestGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)

    @field_validator("name", "description")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value


class CaseIds(BaseModel):
    case_ids: list[int] = Field(min_length=1, max_length=1000)


class OrderedCaseIds(BaseModel):
    case_ids: list[int] = Field(max_length=1000)


class DataPackageAssignmentBulk(BaseModel):
    automation_test_case_ids: list[int] = Field(min_length=1, max_length=1000)
    data_package_id: int


class DataPackageIds(BaseModel):
    data_package_ids: list[int] = Field(default_factory=list, max_length=1000)


class TestGroupDeletionImpact(BaseModel):
    test_group_id: int
    name: str
    source_test_cases: int
    automation_test_cases: int
    data_package_assignments: int
    manual_test_result_batches: int
    manual_test_results: int
    manual_test_result_attachments: int
    message: str


class TestGroupSummary(BaseModel):
    id: int
    product_version_id: int
    name: str
    description: str
    hidden: bool
    source_test_case_count: int
    automation_test_case_count: int
    data_package_assignment_count: int
    created_at: datetime
    updated_at: datetime


class TestGroupPage(BaseModel):
    items: list[TestGroupSummary]
    page: int
    page_size: int
    total: int


class TestGroupSourceCase(BaseModel):
    id: int
    case_number: str
    title: str
    test_type: str
    software_version: str
    position: int


class AssignedDataPackage(BaseModel):
    id: int
    package_number: str
    validation_status: str
    has_newer_source_result: bool
    recommended_source_run_id: int | None
    warnings: list[str]


class TestGroupAutomationCase(BaseModel):
    id: int
    case_number: str
    source_case_number: str
    title: str
    validation_status: str
    source_software_version: str
    position: int
    data_packages: list[AssignedDataPackage]


class TestGroupDetail(TestGroupSummary):
    source_test_cases: list[TestGroupSourceCase]
    automation_test_cases: list[TestGroupAutomationCase]
