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
    # 软件版本来源：imported 保留文件里的软件版本列，current 统一用当前产品版本。
    software_version_source: Literal["imported", "current"] = "imported"
    # 覆盖该产品版本之前导入的用例表，避免同一批用例重复导入。
    replace_existing: bool = False

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
    def merge_continuation_rows(self):
        """把多行一条用例的表合并：编号为空的行视为上一条用例的续行。

        测试用例表常用合并单元格写多条步骤/预期，续行没有编号和标题；
        这里把续行的步骤、预期结果追加到上一条用例，其他空列做补全。
        """
        number_column = self.field_mapping.get("case_number", "")
        if not number_column:
            return self
        steps_column = self.field_mapping.get("steps", "")
        expected_column = self.field_mapping.get("expected_result", "")
        merged: list[dict[str, str]] = []
        for row in self.rows:
            if not row.get(number_column, "").strip() and merged:
                target = merged[-1]
                for column, value in row.items():
                    text = (value or "").strip()
                    if not text:
                        continue
                    if column in {steps_column, expected_column}:
                        existing = target.get(column, "").strip()
                        target[column] = f"{existing}\n{text}" if existing else text
                    elif not target.get(column, "").strip():
                        target[column] = text
                continue
            merged.append(dict(row))
        self.rows = merged
        return self

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
    # 执行方式：存在已校验的自动化用例才算“自动化”，否则是“人工”。
    case_type: Literal["automation", "manual"] = "manual"
    # 该原始用例对应的自动化用例 id（没有则为空）。
    automation_test_case_id: int | None = None
    # 该自动化用例的校验状态（passed / unvalidated / failed）。
    automation_validation_status: str | None = None


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
