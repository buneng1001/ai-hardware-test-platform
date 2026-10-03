from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.run_models import Scenario

SourceType = Literal["generated", "imported"]
DataKind = Literal["normal", "fault"]
ValidationStatus = Literal["passed", "failed"]


class DataPackageFile(BaseModel):
    kind: str
    path: str
    size_bytes: int
    sha256: str
    codec: str | None = None
    start_raw_device_timestamp_ns: int | None = None


class DataPackageIntegrity(BaseModel):
    status: ValidationStatus
    checked_file_count: int
    missing_files: list[str]
    size_mismatches: list[str]


class DataPackage(BaseModel):
    id: int
    package_number: str
    source_task_id: int
    source_task_name: str
    source_run_id: int
    source_run_execution_number: int
    source_type: SourceType
    data_kind: DataKind
    fault_type: Scenario | None
    version_fingerprint: str
    generated_at: datetime
    validation_status: ValidationStatus
    validation_message: str
    channels: list[str]
    timestamps: dict[str, int | str | None]
    integrity: DataPackageIntegrity
    eligible_for_test_group: bool
    has_newer_source_result: bool
    recommended_source_run_id: int | None
    files: list[DataPackageFile] = Field(default_factory=list)


class DataPackagePage(BaseModel):
    items: list[DataPackage]


class DataPackageDeletionImpact(BaseModel):
    data_package_id: int
    package_number: str
    association_counts: dict[str, int]
    total_associations: int
