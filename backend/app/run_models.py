from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

MAX_ACTUAL_DURATION_SECONDS = 5
MAX_VIDEO_PIXEL_FRAMES = 600_000_000


class VideoConfiguration(BaseModel):
    channels: int = Field(ge=1, le=4)
    resolution: Literal["640x360", "1280x720", "1920x1080"]
    fps: Literal[15, 24, 25, 30, 60]
    container: Literal["mp4", "mkv"]
    codec: Literal["h264"] = "h264"


class ImuConfiguration(BaseModel):
    format: Literal["csv", "jsonl"]
    sample_rate_hz: Literal[50, 100, 200, 500]


class RunConfigurationSnapshot(BaseModel):
    mode: Literal["quick", "standard", "custom"]
    scenario: Literal["normal"]
    duration_seconds: int = Field(ge=2, le=300)
    video: VideoConfiguration
    imu: ImuConfiguration
    random_seed: int = Field(ge=0, le=2_147_483_647)

    @model_validator(mode="after")
    def protect_local_file_size(self) -> "RunConfigurationSnapshot":
        width, height = (int(part) for part in self.video.resolution.split("x"))
        actual_duration = min(self.duration_seconds, MAX_ACTUAL_DURATION_SECONDS)
        pixel_frames = width * height * self.video.fps * self.video.channels * actual_duration
        if pixel_frames > MAX_VIDEO_PIXEL_FRAMES:
            raise ValueError("预计文件规模超过安全上限，请降低分辨率、帧率或通道数")
        return self


class GenerationMetadata(BaseModel):
    timeline_source: Literal["actual_generated", "virtual_time_simulated"]
    requested_duration_seconds: int
    generated_duration_seconds: int
    reproducibility_fingerprint: str


class StageEvent(BaseModel):
    stage: Literal["queued", "generating_data", "running_checks", "summarizing_results", "completed"]
    occurred_at: datetime


class Artifact(BaseModel):
    kind: Literal["video", "imu", "device_status", "device_log", "fault_truth"]
    path: str
    source: Literal["actual_generated", "virtual_time_simulated"]
    size_bytes: int
    sha256: str


class BasicCheck(BaseModel):
    name: str
    status: Literal["passed", "failed"]
    message: str


class RunRecord(BaseModel):
    id: int
    collection_task_id: int
    status: Literal["queued", "generating_data", "running_checks", "summarizing_results", "completed", "failed"]
    configuration_snapshot: RunConfigurationSnapshot
    events: list[StageEvent]
    artifacts: list[Artifact]
    generation_metadata: GenerationMetadata | None
    checks: list[BasicCheck]
    created_at: datetime
    completed_at: datetime | None
    error: str | None
