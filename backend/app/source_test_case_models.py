from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SOURCE_CASE_FIELDS = (
    "case_number",
    "title",
    "priority",
    "preconditions",
    "input",
    "steps",
    "expected_result",
    "test_type",
    "module",
    "test_item",
    "test_result",
    "test_record",
    "pre_test_notes",
    "planned_execution_time",
    "attachment",
    "software_version",
)

OPTIONAL_IMPORT_FIELDS = {
    "test_result": "include_historical_results",
    "test_record": "include_test_records",
    "pre_test_notes": "include_pre_test_notes",
    "planned_execution_time": "include_planned_execution_time",
    "attachment": "include_attachments",
}


class ImportOptions(BaseModel):
    include_historical_results: bool = False
    include_test_records: bool = False
    include_pre_test_notes: bool = False
    include_planned_execution_time: bool = False
    include_attachments: bool = False


class SourceTestCaseImportCommand(BaseModel):
    model_config = ConfigDict(extra="ignore")

    source_filename: str = Field(min_length=1, max_length=255)
    field_mapping: dict[str, str] = Field(default_factory=dict)
    rows: list[dict[str, str]] = Field(min_length=1, max_length=1000)
    import_options: ImportOptions = Field(default_factory=ImportOptions)

    @field_validator("source_filename")
    @classmethod
    def normalize_filename(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("文件名不能为空")
        return normalized

    @field_validator("field_mapping")
    @classmethod
    def validate_mapping(cls, value: dict[str, str]) -> dict[str, str]:
        unknown = set(value) - set(SOURCE_CASE_FIELDS)
        if unknown:
            raise ValueError(f"字段映射包含未知字段：{','.join(sorted(unknown))}")
        return {field: source.strip() for field, source in value.items() if source.strip()}

    @field_validator("rows")
    @classmethod
    def normalize_rows(cls, rows: list[dict[str, str]]) -> list[dict[str, str]]:
        return [{str(key): str(value or "") for key, value in row.items()} for row in rows]

    @model_validator(mode="after")
    def require_case_identity_and_unique_numbers(self):
        for required in ("case_number", "title"):
            if not self.field_mapping.get(required):
                raise ValueError(f"字段映射必须包含{field_label(required)}")
        case_numbers = [row.get(self.field_mapping["case_number"], "").strip() for row in self.rows]
        if not all(case_numbers):
            raise ValueError("用例编号不能为空")
        if len(case_numbers) != len(set(case_numbers)):
            raise ValueError("同一导入记录内原始用例编号必须唯一")
        if any(not row.get(self.field_mapping["title"], "").strip() for row in self.rows):
            raise ValueError("测试用例标题不能为空")
        return self


class SourceTestCaseSelectionCommand(BaseModel):
    source_test_case_ids: list[int] = Field(default_factory=list, max_length=1000)


class SourceTestCaseImportRecord(BaseModel):
    id: int
    product_version_id: int
    source_filename: str
    field_mapping: dict[str, str]
    import_options: ImportOptions
    imported_at: str


class SourceTestCase(BaseModel):
    id: int
    import_record_id: int | None
    source_import_status: Literal["active", "import_deleted"]
    case_number: str
    title: str
    priority: str
    preconditions: str
    input: str
    steps: str
    expected_result: str
    test_type: str
    module: str
    test_item: str
    test_result: str
    test_record: str
    pre_test_notes: str
    planned_execution_time: str
    attachment: str
    software_version: str
    selected: bool


class SourceTestCaseList(BaseModel):
    items: list[SourceTestCase]


class ImportDeletionImpact(BaseModel):
    import_record_id: int
    source_test_cases: int
    automation_test_cases: int
    message: str


FIELD_LABELS = {
    "case_number": "用例编号",
    "title": "测试用例标题",
    "priority": "优先级",
    "preconditions": "预置条件",
    "input": "输入",
    "steps": "操作步骤",
    "expected_result": "预期结果",
    "test_type": "测试类型",
    "module": "模块",
    "test_item": "测试项",
    "test_result": "测试结果",
    "test_record": "测试记录",
    "pre_test_notes": "测试前备注信息",
    "planned_execution_time": "计划执行时间",
    "attachment": "附件",
    "software_version": "软件版本",
}


def field_label(field: str) -> str:
    return FIELD_LABELS[field]
