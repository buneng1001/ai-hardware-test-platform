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
    "normal",
    "video_drop",
    "imu_anomaly",
    "storage_exhaustion",
    "temperature_combination",
    "fixed_offset",
    "linear_drift",
]
ReferenceChannel = Literal["camera_1", "camera_2", "camera_3", "camera_4", "imu"]
EvaluationMode = Literal["requirements_acceptance", "engineering_target", "baseline_analysis"]
ThresholdSource = Literal["formal_specification", "engineering_target", "version_baseline"]


class EvaluationConfiguration(BaseModel):
    """判定配置；阈值由测试工程师提供，不由 AI 生成。"""

    mode: EvaluationMode = "requirements_acceptance"
    threshold_source: ThresholdSource = "formal_specification"
    thresholds: dict[str, float] = Field(default_factory=lambda: {"max_failed_checks": 0.0})
    priority: tuple[ThresholdSource, ...] = (
        "formal_specification",
        "engineering_target",
        "version_baseline",
    )

    @model_validator(mode="after")
    def validate_source_and_thresholds(self) -> "EvaluationConfiguration":
        expected_sources = {
            "requirements_acceptance": "formal_specification",
            "engineering_target": "engineering_target",
            "baseline_analysis": "version_baseline",
        }
        if self.threshold_source != expected_sources[self.mode]:
            raise ValueError("判定模式与阈值来源不匹配")
        if self.mode != "baseline_analysis" and not self.thresholds:
            raise ValueError("至少需要提供一项阈值")
        allowed_names = {"max_failed_checks", "max_alignment_residual_ms"}
        unknown_names = set(self.thresholds) - allowed_names
        if unknown_names:
            raise ValueError(f"不支持的阈值名称：{', '.join(sorted(unknown_names))}")
        if any(value < 0 for value in self.thresholds.values()):
            raise ValueError("阈值不能为负数")
        failed_check_threshold = self.thresholds.get("max_failed_checks")
        if failed_check_threshold is not None and (
            isinstance(failed_check_threshold, bool) or not failed_check_threshold.is_integer()
        ):
            raise ValueError("允许失败检查数必须是整数")
        if set(self.priority) != {
            "formal_specification",
            "engineering_target",
            "version_baseline",
        }:
            raise ValueError("判定优先级必须包含三种阈值来源且各出现一次")
        if len(self.priority) != len(set(self.priority)):
            raise ValueError("判定优先级不能重复")
        return self


class VideoConfiguration(BaseModel):
    channels: int = Field(ge=1, le=4)
    resolution: Literal["640x360", "1280x720", "1920x1080"]
    fps: Literal[15, 24, 25, 30, 60]
    container: Literal["mp4", "mkv"]
    codec: Literal["h264"] = "h264"
    bitrate_kbps: int = Field(default=2500, ge=256, le=50_000)
    bitrate_mode: Literal["cbr", "vbr"] = "cbr"


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
    evaluation: EvaluationConfiguration = Field(default_factory=EvaluationConfiguration)

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
    time_contract: dict[str, object] = Field(default_factory=dict)


class StageEvent(BaseModel):
    stage: RunStatus
    occurred_at: datetime


class Artifact(BaseModel):
    kind: Literal["video", "imu", "device_status", "device_log", "fault_truth", "frame_imu_alignment"]
    path: str
    source: Literal["actual_generated", "virtual_time_simulated"]
    size_bytes: int
    sha256: str
    codec: Literal["h264"] | None = None
    start_raw_device_timestamp_ns: int | None = None


class BasicCheck(BaseModel):
    name: str
    category: Literal["video", "imu", "resource", "log", "storage"] = "video"
    status: Literal["passed", "failed"]
    message: str
    metrics: dict[str, int | float | str] = Field(default_factory=dict)
    anomaly_windows: list[dict[str, int | float]] = Field(default_factory=list)
    truth_comparison: Literal["matched", "missed", "not_applicable"] = "not_applicable"
    evidence_refs: list[str] = Field(default_factory=list)


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
    frame_imu_alignment: "FrameImuAlignmentSummary | None" = None
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


class FrameImuAlignmentSummary(BaseModel):
    """逐帧映射派生产物的可追溯摘要；详细行保存在独立 CSV 中。"""

    artifact_path: str
    frame_count: int = Field(ge=0)
    matched_count: int = Field(ge=0)
    unmatched_count: int = Field(ge=0)
    imu_sample_rate_hz: int
    tolerance_s: float = Field(ge=0)
    columns: list[str]


class EvaluationResult(BaseModel):
    """运行完成后的判定结果，与自动化检查结果分开保存。"""

    mode: EvaluationMode
    threshold_source: ThresholdSource
    thresholds: dict[str, float]
    priority: tuple[ThresholdSource, ...]
    priority_rank: int
    conclusion: Literal["passed", "failed", "not_applicable"]
    is_product_commitment: bool
    metrics: dict[str, float | int]
    distribution: dict[str, int]
    trend: list[int]
    summary: str


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


class DiagnosisEvidenceItem(BaseModel):
    """诊断证据包中的限量条目；ref 是诊断输出可引用的稳定编号。"""

    ref: str = Field(pattern=r"^E[0-9]{3}$")
    kind: Literal[
        "configuration",
        "threshold",
        "failed_check",
        "anomaly_window",
        "resource_metric",
        "device_log",
        "imu_summary",
        "keyframe",
        "manual_result",
    ]
    source: str
    content: str
    size_bytes: int = Field(ge=0)
    estimated_tokens: int = Field(ge=0)


class DiagnosisEvidencePackage(BaseModel):
    items: list[DiagnosisEvidenceItem]
    total_bytes: int = Field(ge=0)
    estimated_tokens: int = Field(ge=0)
    max_bytes: int = Field(gt=0)
    max_tokens: int = Field(gt=0)
    truncated: bool


class DiagnosisPhenomenon(BaseModel):
    description: str
    evidence_refs: list[str]


class DiagnosisCause(BaseModel):
    cause: str
    evidence_refs: list[str]
    confidence: Literal["high", "medium", "low"]
    is_speculation: bool


class StructuredDiagnosis(BaseModel):
    diagnosis_status: Literal["completed", "failed"]
    phenomena: list[DiagnosisPhenomenon]
    possible_causes: list[DiagnosisCause]
    impact_scope: list[str]
    retest_recommendations: list[str]
    missing_evidence: list[str]
    uncertainties: list[str]
    limitations: list[str]


class AiEvaluationResult(BaseModel):
    """把 AI 诊断与预先保存的故障真值分开评价。"""

    status: Literal["evaluated", "not_evaluated"]
    structure_valid: bool
    scenario: Scenario
    expected_fault_types: list[str]
    diagnosed_fault_types: list[str]
    hit_fault_types: list[str]
    missed_fault_types: list[str]
    hit_count: int = Field(ge=0)
    missed_count: int = Field(ge=0)
    unsupported_speculation_count: int = Field(ge=0)
    false_positive_count: int = Field(ge=0)
    reason: str | None = None
    summary: str


class DiagnosisRun(BaseModel):
    id: int
    run_id: int
    status: Literal["pending", "generating", "completed", "failed"]
    model: str
    prompt_version: str
    is_mock: bool
    evidence_package: DiagnosisEvidencePackage
    output: StructuredDiagnosis | None
    evaluation: AiEvaluationResult | None
    error: str | None
    created_at: datetime
    completed_at: datetime | None


class RunRecord(BaseModel):
    id: int
    collection_task_id: int
    task_name: str = ""
    task_execution_number: int = Field(default=1, ge=1)
    queue_position: int | None = Field(default=None, ge=1)
    stage_status: RunStatus = "queued"
    status: RunStatus
    configuration_snapshot: RunConfigurationSnapshot
    events: list[StageEvent]
    artifacts: list[Artifact]
    generation_metadata: GenerationMetadata | None
    checks: list[BasicCheck]
    alignment_result: TimeAlignmentResult | None
    evaluation_result: EvaluationResult | None
    manual_check_results: list[ManualCheckResult]
    diagnosis_runs: list[DiagnosisRun] = Field(default_factory=list)
    created_at: datetime
    completed_at: datetime | None
    error: str | None
