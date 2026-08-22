from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class VideoConfiguration(BaseModel):
    channels: Literal[1]
    resolution: Literal["640x360"]
    fps: Literal[15]
    container: Literal["mp4"]
    codec: Literal["h264"]


class ImuConfiguration(BaseModel):
    format: Literal["csv"]
    sample_rate_hz: Literal[50]


class RunConfigurationSnapshot(BaseModel):
    mode: Literal["quick"]
    scenario: Literal["normal"]
    duration_seconds: Literal[2]
    video: VideoConfiguration
    imu: ImuConfiguration
    random_seed: Literal[20260822]


class StageEvent(BaseModel):
    stage: Literal[
        "queued",
        "generating_data",
        "running_checks",
        "summarizing_results",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
    ]
    occurred_at: datetime


class Artifact(BaseModel):
    kind: Literal["video", "imu", "device_status", "device_log", "fault_truth"]
    path: str
    source: Literal["actual_generated"]
    size_bytes: int
    sha256: str


class BasicCheck(BaseModel):
    name: str
    status: Literal["passed", "failed"]
    message: str


class RunRecord(BaseModel):
    id: int
    collection_task_id: int
    status: Literal[
        "queued",
        "generating_data",
        "running_checks",
        "summarizing_results",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
    ]
    configuration_snapshot: RunConfigurationSnapshot
    events: list[StageEvent]
    artifacts: list[Artifact]
    checks: list[BasicCheck]
    created_at: datetime
    completed_at: datetime | None
    error: str | None
