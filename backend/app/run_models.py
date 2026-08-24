from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

MAX_ACTUAL_DURATION_SECONDS = 5
MAX_VIDEO_PIXEL_FRAMES = 600_000_000

RunStatus = Literal[
    "queued",
    "generating_data",
    "running_checks",
    "summarizing_results",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
]

Scenario = Literal[
    "normal", "video_drop", "imu_anomaly", "storage_exhaustion", "fixed_offset", "linear_drift"
]
ReferenceChannel = Literal["camera_1", "camera_2", "camera_3", "camera_4", "imu"]

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
    scenario: Scenario
    duration_seconds: int = Field(ge=2, le=300)
    video: VideoConfiguration
    imu: ImuConfiguration
    random_seed: int = Field(ge=0, le=2_147_483_647)
    reference_channel: ReferenceChannel = "camera_1"

    @model_validator(mode="after")
    def protect_local_file_size(self) -> "RunConfigurationSnapshot":
        width, height = (int(part) for part in self.video.resolution.split("x"))
        actual_duration = min(self.duration_seconds, MAX_ACTUAL_DURATION_SECONDS)
        pixel_frames = width * height * self.video.fps * self.video.channels * actual_duration
        if pixel_frames > MAX_VIDEO_PIXEL_FRAMES:
            raise ValueError("预计文件规模超过安全上限，请降低分辨率、帧率或通道数")
        return self

    @model_validator(mode="after")
    def validate_reference_channel(self) -> "RunConfigurationSnapshot":
        if self.reference_channel.startswith("camera_"):
            channel = int(self.reference_channel.removeprefix("camera_"))
            if channel > self.video.channels:
                raise ValueError(f"参考通道 {self.reference_channel} 不在当前视频通道范围内")
        return self


class GenerationMetadata(BaseModel):
    timeline_source: Literal["actual_generated", "virtual_time_simulated"]
    requested_duration_seconds: int
    generated_duration_seconds: int
    reproducibility_fingerprint: str
    temperature_range_c: tuple[float, float]
    storage_range_mb: tuple[int, int]


class StageEvent(BaseModel):
    stage: RunStatus
    occurred_at: datetime


class Artifact(BaseModel):
    kind: Literal["video", "imu", "device_status", "device_log", "fault_truth"]
    path: str
    source: Literal["actual_generated", "virtual_time_simulated"]
    size_bytes: int
    sha256: str
    codec: Literal["h264"] | None = None


class BasicCheck(BaseModel):
    name: str
    category: Literal["video", "imu", "storage"] = "video"
    status: Literal["passed", "failed"]
    message: str
    metrics: dict[str, int | float | str] = Field(default_factory=dict)
    anomaly_windows: list[dict[str, int | float]] = Field(default_factory=list)
    truth_comparison: Literal["matched", "missed", "not_applicable"] = "not_applicable"


class TimeAlignmentResult(BaseModel):
    reference_channel: str
    method: Literal["fixed_offset_anchor", "linear_drift_regression"]
    parameters: dict[str, float]
    drift_rates_s_per_s: dict[str, float] = Field(default_factory=dict)
    anchors: dict[str, list[float]] = Field(default_factory=dict)
    pre_alignment: dict[str, dict[str, float]]
    post_alignment: dict[str, dict[str, float]]
    trend: dict[str, list[float]] = Field(default_factory=dict)
    anchor_details: list["AlignmentAnchor"] = Field(default_factory=list)
    content_sync: "ContentSyncResult"
    review_revision: int = 0
    truth_comparison: Literal["matched", "missed", "not_applicable"] = "not_applicable"


class AlignmentAnchor(BaseModel):
    """跨模态事件锚点；复核时间与原始检测时间分开保存。"""

    id: str
    channel: str
    event_index: int = Field(ge=0)
    detected_time_s: float
    reviewed_time_s: float | None
    included: bool
    source: Literal["video_flash", "imu_peak"]


class ContentSyncResult(BaseModel):
    """不依赖时间接近度的画面事件与 IMU 事件内容对应结果。"""

    status: Literal["passed", "failed", "degraded"]
    video_event_count: int = Field(ge=0)
    imu_event_count: int = Field(ge=0)
    matched_event_count: int = Field(ge=0)
    matched_event_indices: list[int] = Field(default_factory=list)
    message: str


class AlignmentReviewItem(BaseModel):
    """一次锚点人工复核提交的变更。"""

    anchor_id: str
    reviewed_time_s: float | None = Field(default=None, ge=0)
    included: bool = True


class AlignmentReviewCommand(BaseModel):
    """只提交需要复核的锚点，未提交的锚点保持自动识别结果。"""

    anchors: list[AlignmentReviewItem]


class ManualCheckResult(BaseModel):
    id: int
    run_id: int
    name: str
    status: Literal["passed", "failed", "blocked", "not_run"]
    actual_result: str | None
    notes: str | None
    executed_at: datetime | None
    attachment: dict[str, str | int] | None
    created_at: datetime
    updated_at: datetime


class RunRecord(BaseModel):
    id: int
    collection_task_id: int
    status: RunStatus
    configuration_snapshot: RunConfigurationSnapshot
    events: list[StageEvent]
    artifacts: list[Artifact]
    generation_metadata: GenerationMetadata | None
    checks: list[BasicCheck]
    alignment_result: TimeAlignmentResult | None
    manual_check_results: list[ManualCheckResult]
    created_at: datetime
    completed_at: datetime | None
    error: str | None
