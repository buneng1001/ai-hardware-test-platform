from datetime import datetime

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


class FactReport(BaseModel):
    id: int
    test_group_id: int
    product_version_id: int
    automation_execution_id: int | None
    manual_batch_ids: list[int]
    snapshot: dict[str, object]
    created_at: datetime
