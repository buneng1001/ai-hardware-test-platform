"""多通道固定偏移时间对齐：估计偏移、保留原始证据并输出对齐前后指标。"""

from pathlib import Path

from app.artifact_io import read_fault_truth
from app.run_models import (
    AlignmentAnchor,
    Artifact,
    ContentSyncResult,
    RunConfigurationSnapshot,
    TimeAlignmentResult,
)
from app.time_alignment_io import (
    _read_imu_timeline,
    _read_video_timelines,
)
from app.time_alignment_metrics import (
    _compare_linear_model,
    _compare_offsets,
    _linear_fit,
    _percentile,
    _post_alignment_residuals,
    _pre_alignment_metrics,
    _relative_truth_offsets,
    _relative_truth_rates,
    _std,
)


def align_fixed_offset(
    artifacts: list[Artifact],
    data_dir: Path,
    snapshot: RunConfigurationSnapshot,
    anchor_overrides: dict[str, tuple[float | None, bool]] | None = None,
    review_revision: int = 0,
) -> TimeAlignmentResult | None:
    """对固定偏移场景的原始时间戳执行参考通道对齐并返回独立结果。"""
    if snapshot.scenario != "fixed_offset":
        return None

    reference_channel = snapshot.reference_channel
    video_timelines = _read_video_timelines(artifacts, data_dir)
    imu_timeline = _read_imu_timeline(artifacts, data_dir, snapshot.imu.format)
    all_channels = {**video_timelines, "imu": imu_timeline} if imu_timeline else video_timelines

    if reference_channel not in all_channels:
        return None

    detected_anchors = _detect_anchor_times(all_channels)
    reviewed_anchors = _apply_anchor_overrides(detected_anchors, anchor_overrides)
    active_anchors = {
        channel: [value for value in values if value >= 0] for channel, values in reviewed_anchors.items()
    }
    if reference_channel not in active_anchors:
        return None
    reference_anchor = active_anchors[reference_channel][0]
    estimated_offsets_s = {
        channel: round(reference_anchor - values[0], 3) for channel, values in active_anchors.items()
    }

    pre_alignment = _pre_alignment_metrics(all_channels, estimated_offsets_s, reference_channel, snapshot)
    post_alignment = _post_alignment_residuals(
        all_channels,
        estimated_offsets_s,
        reference_anchor,
        reference_channel,
        snapshot,
        reviewed_anchors,
    )

    truth = read_fault_truth(artifacts, data_dir)
    truth_offsets = _relative_truth_offsets(truth.get("alignment_corrections_s", {}), reference_channel)
    truth_comparison = _compare_offsets(estimated_offsets_s, truth_offsets)

    return TimeAlignmentResult(
        reference_channel=reference_channel,
        method="fixed_offset_anchor",
        parameters=estimated_offsets_s,
        anchors=detected_anchors,
        pre_alignment=pre_alignment,
        post_alignment=post_alignment,
        anchor_details=_anchor_details(detected_anchors, reviewed_anchors),
        content_sync=_content_sync(detected_anchors),
        review_revision=review_revision,
        truth_comparison=truth_comparison,
    )


def align_linear_drift(
    artifacts: list[Artifact],
    data_dir: Path,
    snapshot: RunConfigurationSnapshot,
    anchor_overrides: dict[str, tuple[float | None, bool]] | None = None,
    review_revision: int = 0,
) -> TimeAlignmentResult | None:
    """用多个共同事件拟合线性校正，保留每个通道的原始锚点序列。"""
    if snapshot.scenario != "linear_drift":
        return None

    video_timelines = _read_video_timelines(artifacts, data_dir)
    imu_timeline = _read_imu_timeline(artifacts, data_dir, snapshot.imu.format)
    channels = {**video_timelines, "imu": imu_timeline} if imu_timeline else video_timelines
    if snapshot.reference_channel not in channels:
        return None
    detected_anchors = _detect_anchor_times(channels)
    reviewed_anchors = _apply_anchor_overrides(detected_anchors, anchor_overrides)
    common_indices = [
        index
        for index in range(len(reviewed_anchors.get(snapshot.reference_channel, [])))
        if all(index < len(times) and times[index] >= 0 for times in reviewed_anchors.values())
    ]
    anchors = {channel: [times[index] for index in common_indices] for channel, times in reviewed_anchors.items()}
    reference_anchors = anchors[snapshot.reference_channel]
    if (
        len(reference_anchors) < 3
        or any(len(channel_anchors) != len(reference_anchors) for channel_anchors in anchors.values())
        or len(set(reference_anchors)) < 2
    ):
        return None

    parameters: dict[str, float] = {}
    drift_rates: dict[str, float] = {}
    pre_alignment: dict[str, dict[str, float]] = {}
    post_alignment: dict[str, dict[str, float]] = {}
    trend: dict[str, list[float]] = {}
    for channel, channel_anchors in anchors.items():
        count = min(len(reference_anchors), len(channel_anchors))
        x_values = reference_anchors[:count]
        corrections = [x - y for x, y in zip(x_values, channel_anchors[:count])]
        intercept, slope = _linear_fit(x_values, corrections)
        parameters[channel] = round(intercept, 6)
        drift_rates[channel] = round(slope, 6)
        pre_alignment[channel] = {
            "offset_s": round(-corrections[0], 6),
            "jitter_ms": round(_std(corrections) * 1000, 3),
            "drift_s_per_s": round(-slope, 6),
            "max_residual_ms": round(max(abs(value) for value in corrections) * 1000, 3),
        }
        residuals = [y + intercept + slope * x - x for x, y in zip(x_values, channel_anchors[:count])]
        trend[channel] = [round(value * 1000, 3) for value in residuals]
        post_alignment[channel] = {
            "max_residual_ms": round(max(abs(value) for value in residuals) * 1000, 3),
            "mean_residual_ms": round(sum(abs(value) for value in residuals) / len(residuals) * 1000, 3),
            "p95_residual_ms": round(_percentile([abs(value) for value in residuals], 0.95) * 1000, 3),
        }

    truth = read_fault_truth(artifacts, data_dir)
    truth_offsets = _relative_truth_offsets(truth.get("alignment_corrections_s", {}), snapshot.reference_channel)
    truth_drifts = _relative_truth_rates(truth.get("alignment_drift_rates_s_per_s", {}), snapshot.reference_channel)
    truth_comparison = _compare_linear_model(parameters, drift_rates, truth_offsets, truth_drifts)
    return TimeAlignmentResult(
        reference_channel=snapshot.reference_channel,
        method="linear_drift_regression",
        parameters=parameters,
        drift_rates_s_per_s=drift_rates,
        anchors=detected_anchors,
        pre_alignment=pre_alignment,
        post_alignment=post_alignment,
        trend=trend,
        anchor_details=_anchor_details(detected_anchors, reviewed_anchors),
        content_sync=_content_sync(detected_anchors),
        review_revision=review_revision,
        truth_comparison=truth_comparison,
    )


def align_imported_data(
    artifacts: list[Artifact], data_dir: Path, snapshot: RunConfigurationSnapshot
) -> TimeAlignmentResult | None:
    """为导入数据创建不修改原始时间的基础对齐结果。"""
    video_artifacts = [artifact for artifact in artifacts if artifact.kind == "video"]
    imu_artifact = next((artifact for artifact in artifacts if artifact.kind == "imu"), None)
    if not video_artifacts or imu_artifact is None:
        return None
    channels = {f"camera_{index}": {} for index in range(1, len(video_artifacts) + 1)}
    channels["imu"] = {}
    metrics = {channel: {"offset_s": 0.0, "jitter_ms": 0.0} for channel in channels}
    residuals = {
        channel: {"max_residual_ms": 0.0, "mean_residual_ms": 0.0, "p95_residual_ms": 0.0} for channel in channels
    }
    return TimeAlignmentResult(
        reference_channel=snapshot.reference_channel,
        method="fixed_offset_anchor",
        parameters={channel: 0.0 for channel in channels},
        pre_alignment=metrics,
        post_alignment=residuals,
        anchors={},
        anchor_details=[],
        content_sync=ContentSyncResult(
            status="degraded",
            video_event_count=0,
            imu_event_count=0,
            matched_event_count=0,
            message="导入数据未提供可用于内容事件对应的合成真值锚点",
        ),
    )


def _anchor_time(channel: str, timeline: list[tuple[float, float]]) -> float:
    """返回通道锚点时间：视频取最亮帧（闪光），IMU 取冲击峰值样本。"""
    return max(timeline, key=lambda sample: sample[1])[0]


def _detect_anchor_times(channels: dict[str, list[tuple[float, float]]]) -> dict[str, list[float]]:
    """从视频闪光和 IMU 冲击峰值提取稳定的、按事件顺序排列的锚点。"""
    return {channel: _anchor_times(channel, timeline) for channel, timeline in channels.items()}


def _apply_anchor_overrides(
    detected: dict[str, list[float]], overrides: dict[str, tuple[float | None, bool]] | None
) -> dict[str, list[float]]:
    """把人工复核应用到副本，保留未复核锚点和原始检测结果。"""
    adjusted = {channel: list(times) for channel, times in detected.items()}
    for anchor_id, (reviewed_time, included) in (overrides or {}).items():
        channel, raw_index = anchor_id.split(":", maxsplit=1)
        index = int(raw_index.removeprefix("event-"))
        if channel not in adjusted or index >= len(adjusted[channel]):
            continue
        adjusted[channel][index] = reviewed_time if included and reviewed_time is not None else -1.0
    return adjusted


def _anchor_details(detected: dict[str, list[float]], adjusted: dict[str, list[float]]) -> list[AlignmentAnchor]:
    details: list[AlignmentAnchor] = []
    for channel, detected_times in detected.items():
        active_times = adjusted.get(channel, [])
        for index, detected_time in enumerate(detected_times):
            active = index < len(active_times) and active_times[index] >= 0
            reviewed_time = active_times[index] if active else None
            details.append(
                AlignmentAnchor(
                    id=f"{channel}:event-{index}",
                    channel=channel,
                    event_index=index,
                    detected_time_s=detected_time,
                    reviewed_time_s=reviewed_time,
                    included=active,
                    source="imu_peak" if channel == "imu" else "video_flash",
                )
            )
    return details


def _content_sync(detected: dict[str, list[float]]) -> ContentSyncResult:
    """按事件序号比对画面闪光和 IMU 峰值，不把时间接近当作内容同步。"""
    video_counts = [len(times) for channel, times in detected.items() if channel != "imu"]
    video_count = max(video_counts, default=0)
    imu_count = len(detected.get("imu", []))
    video_indices = list(range(video_count))
    imu_indices = list(range(imu_count))
    matched_indices = [index for index in video_indices if index in imu_indices]
    matched = len(matched_indices)
    if not video_count or not imu_count:
        status = "degraded"
        message = "缺少视频闪光或 IMU 冲击峰值，无法完成内容事件对应"
    elif len(set(video_counts)) != 1 or video_count != imu_count:
        status = "failed"
        message = "各路视频闪光事件或 IMU 冲击峰值数量不一致"
    else:
        status = "passed"
        message = "视频闪光与 IMU 冲击峰值按事件序号一一对应"
    return ContentSyncResult(
        status=status,
        video_event_count=video_count,
        imu_event_count=imu_count,
        matched_event_count=matched,
        matched_event_indices=matched_indices,
        message=message,
    )


def _anchor_times(channel: str, timeline: list[tuple[float, float]]) -> list[float]:
    """识别多个共同事件，并把相邻高峰合并为单个锚点。"""
    threshold = 230.0 if channel != "imu" else 5.0
    candidates = [timestamp for timestamp, value in timeline if value >= threshold]
    anchors: list[float] = []
    for timestamp in candidates:
        if not anchors or timestamp - anchors[-1] > (0.1 if channel != "imu" else 0.03):
            anchors.append(timestamp)
    return anchors
