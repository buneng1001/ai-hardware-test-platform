"""多通道固定偏移时间对齐：估计偏移、保留原始证据并输出对齐前后指标。"""

import csv
import hashlib
import json
import math
import re
import subprocess
from pathlib import Path
from typing import Literal

import imageio_ffmpeg

from app.artifact_io import read_fault_truth
from app.run_models import (
    AlignmentAnchor,
    Artifact,
    ContentSyncResult,
    FrameImuAlignmentSummary,
    RunConfigurationSnapshot,
    TimeAlignmentResult,
)

RAW_DEVICE_START_NS = 1_700_000_000_000_000_000
FRAME_IMU_ALIGNMENT_COLUMNS = [
    "video_channel",
    "video_frame_number",
    "video_raw_device_timestamp_ns",
    "video_relative_timestamp_s",
    "video_aligned_timestamp_s",
    "imu_sample_index",
    "imu_raw_device_timestamp_ns",
    "imu_relative_timestamp_s",
    "imu_aligned_timestamp_s",
    "time_difference_s",
    "tolerance_s",
    "match_status",
]


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


def build_frame_imu_alignment(
    artifacts: list[Artifact],
    data_dir: Path,
    snapshot: RunConfigurationSnapshot,
    alignment: TimeAlignmentResult,
    output_dir: Path | None = None,
) -> tuple[Artifact, FrameImuAlignmentSummary]:
    """按视频帧寻找对齐后最近邻 IMU 样本，并把结果写入独立 CSV。"""
    video_artifacts = [artifact for artifact in artifacts if artifact.kind == "video"]
    imu_artifact = next((artifact for artifact in artifacts if artifact.kind == "imu"), None)
    if not video_artifacts or imu_artifact is None:
        raise ValueError("缺少视频或 IMU 产物，无法生成逐帧映射")

    imu_rows = _read_imu_rows(data_dir / imu_artifact.path, snapshot.imu.format)
    for sample_index, row in enumerate(imu_rows):
        # 输入契约只要求输出样本序号可追溯；缺少原始序号时由行顺序稳定派生。
        row.setdefault("sample_index", str(sample_index))
    tolerance_s = 1.0 / (2 * snapshot.imu.sample_rate_hz)
    rows: list[list[object]] = []
    matched_count = 0
    for video_index, artifact in enumerate(video_artifacts, start=1):
        correction = alignment.parameters.get(f"camera_{video_index}", 0.0)
        drift = alignment.drift_rates_s_per_s.get(f"camera_{video_index}", 0.0)
        frame_times = _read_video_frame_info(data_dir / artifact.path)
        for frame_number, (relative_time_s, _) in enumerate(frame_times):
            video_aligned_s = relative_time_s + correction + drift * relative_time_s
            nearest = min(
                imu_rows,
                key=lambda row: abs(_aligned_imu_time(row, alignment) - video_aligned_s),
                default=None,
            )
            if nearest is None:
                rows.append(
                    [
                        f"camera_{video_index}",
                        frame_number,
                        _video_raw_timestamp(artifact, relative_time_s),
                        f"{relative_time_s:.6f}",
                        f"{video_aligned_s:.6f}",
                        "",
                        "",
                        "",
                        "",
                        "",
                        f"{tolerance_s:.6f}",
                        "unmatched",
                    ]
                )
                continue
            imu_aligned_s = _aligned_imu_time(nearest, alignment)
            difference_s = imu_aligned_s - video_aligned_s
            matched = abs(difference_s) <= tolerance_s
            matched_count += int(matched)
            rows.append(
                [
                    f"camera_{video_index}",
                    frame_number,
                    _video_raw_timestamp(artifact, relative_time_s),
                    f"{relative_time_s:.6f}",
                    f"{video_aligned_s:.6f}",
                    nearest["sample_index"],
                    nearest["raw_device_timestamp_ns"],
                    nearest["relative_timestamp_s"],
                    f"{imu_aligned_s:.6f}",
                    f"{abs(difference_s):.6f}",
                    f"{tolerance_s:.6f}",
                    "matched" if matched else "unmatched",
                ]
            )

    run_dir = output_dir or (data_dir / video_artifacts[0].path).parent
    run_dir.mkdir(parents=True, exist_ok=True)
    mapping_path = run_dir / "frame-imu-alignment.csv"
    with mapping_path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(FRAME_IMU_ALIGNMENT_COLUMNS)
        writer.writerows(rows)
    artifact = _derived_artifact(mapping_path, data_dir, video_artifacts[0].source)
    summary = FrameImuAlignmentSummary(
        artifact_path=artifact.path,
        frame_count=len(rows),
        matched_count=matched_count,
        unmatched_count=len(rows) - matched_count,
        imu_sample_rate_hz=snapshot.imu.sample_rate_hz,
        tolerance_s=round(tolerance_s, 6),
        columns=FRAME_IMU_ALIGNMENT_COLUMNS,
    )
    return artifact, summary


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
    residuals = {channel: {"max_residual_ms": 0.0, "mean_residual_ms": 0.0, "p95_residual_ms": 0.0}
                 for channel in channels}
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


def _read_imu_rows(path: Path, imu_format: str) -> list[dict[str, str]]:
    """读取保留原始时间字段的 IMU 行，避免映射过程丢失证据。"""
    with path.open(encoding="utf-8", newline="") as file:
        if imu_format == "csv":
            return list(csv.DictReader(file))
        return [json.loads(line) for line in file if line.strip()]


def _aligned_imu_time(row: dict[str, str], alignment: TimeAlignmentResult) -> float:
    relative_time_s = float(row["relative_timestamp_s"])
    correction = alignment.parameters.get("imu", 0.0)
    drift = alignment.drift_rates_s_per_s.get("imu", 0.0)
    return relative_time_s + correction + drift * relative_time_s


def _video_raw_timestamp(artifact: Artifact, relative_time_s: float) -> int:
    """以每路视频的起始设备时间加容器 PTS 派生 raw 时间。"""
    start_ns = artifact.start_raw_device_timestamp_ns or RAW_DEVICE_START_NS
    return start_ns + round(relative_time_s * 1_000_000_000)


def _derived_artifact(path: Path, data_dir: Path, source: str = "actual_generated") -> Artifact:
    content = path.read_bytes()
    return Artifact(
        kind="frame_imu_alignment",
        path=path.relative_to(data_dir).as_posix(),
        source=source,
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )


def _read_video_timelines(artifacts: list[Artifact], data_dir: Path) -> dict[str, list[tuple[float, float]]]:
    """读取视频通道的（时间戳, 平均亮度）序列，亮度用于定位闪光锚点。"""
    timelines: dict[str, list[tuple[float, float]]] = {}
    video_artifacts = [artifact for artifact in artifacts if artifact.kind == "video"]
    for index, artifact in enumerate(video_artifacts, start=1):
        timelines[f"camera_{index}"] = _read_video_frame_info(data_dir / artifact.path)
    return timelines


def _read_video_frame_info(path: Path) -> list[tuple[float, float]]:
    """通过 FFmpeg showinfo 读取视频逐帧 PTS 时间与平均亮度。"""
    inspected = subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-v",
            "info",
            "-i",
            str(path),
            "-vf",
            "showinfo",
            "-f",
            "null",
            "-",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    frames: list[tuple[float, float]] = []
    for line in inspected.stderr.splitlines():
        time_match = re.search(r"pts_time:([0-9.]+)", line)
        mean_match = re.search(r"mean:\[([0-9.]+)", line)
        if time_match and mean_match:
            frames.append((float(time_match.group(1)), float(mean_match.group(1))))
    return frames


def _read_imu_timeline(artifacts: list[Artifact], data_dir: Path, imu_format: str) -> list[tuple[float, float]] | None:
    """读取 IMU 文件原始 (timestamp_s, accel_x) 序列；accel_x 用于定位冲击峰值锚点。"""
    imu_artifact = next((artifact for artifact in artifacts if artifact.kind == "imu"), None)
    if imu_artifact is None:
        return None

    with (data_dir / imu_artifact.path).open(encoding="utf-8", newline="") as file:
        if imu_format == "csv":
            rows = list(csv.DictReader(file))
        else:
            rows = [json.loads(line) for line in file if line.strip()]

    return [
        (
            float(row["relative_timestamp_s"] if "relative_timestamp_s" in row else row["timestamp_s"]),
            float(row["accel_x"]),
        )
        for row in rows
    ]


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


def _expected_interval_s(channel: str, snapshot: RunConfigurationSnapshot) -> float:
    """返回通道的理论采样间隔，用于抖动和残差计算。"""
    if channel == "imu":
        return 1.0 / snapshot.imu.sample_rate_hz
    return 1.0 / snapshot.video.fps


def _pre_alignment_metrics(
    channels: dict[str, list[tuple[float, float]]],
    estimated_offsets_s: dict[str, float],
    reference_channel: str,
    snapshot: RunConfigurationSnapshot,
) -> dict[str, dict[str, float]]:
    """计算对齐前各通道相对参考通道的偏移与抖动。"""
    metrics: dict[str, dict[str, float]] = {}
    for channel, timeline in channels.items():
        timestamps = [sample[0] for sample in timeline]
        intervals = [current - previous for previous, current in zip(timestamps, timestamps[1:])]
        expected = _expected_interval_s(channel, snapshot)
        jitter = _std([abs(interval - expected) for interval in intervals]) if intervals else 0.0
        metrics[channel] = {
            "offset_s": round(-estimated_offsets_s.get(channel, 0.0), 3),
            "jitter_ms": round(jitter * 1000, 3),
        }
    return metrics


def _post_alignment_residuals(
    channels: dict[str, list[tuple[float, float]]],
    estimated_offsets_s: dict[str, float],
    reference_anchor: float,
    reference_channel: str,
    snapshot: RunConfigurationSnapshot,
    anchor_times: dict[str, list[float]] | None = None,
) -> dict[str, dict[str, float]]:
    """应用估计偏移后，各通道相对参考锚点的残差分布。"""
    residuals: dict[str, dict[str, float]] = {}
    for channel, timeline in channels.items():
        correction = estimated_offsets_s.get(channel, 0.0)
        active_anchor = next(
            (value for value in (anchor_times or {}).get(channel, []) if value >= 0),
            None,
        )
        anchor_time = active_anchor if active_anchor is not None else _anchor_time(channel, timeline)
        # 对齐后所有通道的锚点应与参考锚点重合
        anchor_residual = abs((anchor_time + correction) - reference_anchor)

        if channel == "imu":
            # IMU  additionally 检查每个样本相对自身对齐后网格的 jitter 残差
            timestamps = [sample[0] for sample in timeline]
            expected = _expected_interval_s(channel, snapshot)
            aligned_first = timestamps[0] + correction
            grid_residuals = [
                abs((timestamp + correction) - (aligned_first + index * expected))
                for index, timestamp in enumerate(timestamps)
            ]
            absolute_residuals = [anchor_residual, *grid_residuals]
        else:
            absolute_residuals = [anchor_residual]

        residuals[channel] = {
            "max_residual_ms": round(max(absolute_residuals) * 1000, 3) if absolute_residuals else 0.0,
            "mean_residual_ms": round(sum(absolute_residuals) / len(absolute_residuals) * 1000, 3)
            if absolute_residuals
            else 0.0,
            "p95_residual_ms": round(_percentile(absolute_residuals, 0.95) * 1000, 3) if absolute_residuals else 0.0,
        }
    return residuals


def _compare_offsets(
    estimated: dict[str, float], truth: dict[str, float], tolerance_s: float = 0.001
) -> Literal["matched", "missed", "not_applicable"]:
    """将估计偏移与故障真值对比，允许毫秒级容差。"""
    if not truth:
        return "not_applicable"
    for channel, true_offset in truth.items():
        if abs(estimated.get(channel, 0.0) - true_offset) > tolerance_s:
            return "missed"
    return "matched"


def _relative_truth_offsets(truth: dict[str, float], reference_channel: str) -> dict[str, float]:
    """把以 camera_1 为原点的故障真值转换为所选参考通道的原点。"""
    reference_offset = truth.get(reference_channel, 0.0)
    return {channel: round(offset - reference_offset, 6) for channel, offset in truth.items()}


def _relative_truth_rates(truth: dict[str, float], reference_channel: str) -> dict[str, float]:
    """把以 camera_1 为原点的漂移率转换为所选参考通道的原点。"""
    reference_rate = truth.get(reference_channel, 0.0)
    return {channel: round(-(rate - reference_rate), 6) for channel, rate in truth.items()}


def _linear_fit(x_values: list[float], y_values: list[float]) -> tuple[float, float]:
    """用最小二乘拟合 correction = intercept + slope * reference_time。"""
    mean_x = sum(x_values) / len(x_values)
    mean_y = sum(y_values) / len(y_values)
    denominator = sum((value - mean_x) ** 2 for value in x_values)
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(x_values, y_values)) / denominator
    return mean_y - slope * mean_x, slope


def _compare_linear_model(
    estimated_offsets: dict[str, float],
    estimated_rates: dict[str, float],
    truth_offsets: dict[str, float],
    truth_rates: dict[str, float],
    tolerance_s: float = 0.04,
) -> Literal["matched", "missed", "not_applicable"]:
    """同时校验线性模型截距和斜率。"""
    if not truth_offsets or not truth_rates:
        return "not_applicable"
    for channel, true_offset in truth_offsets.items():
        if abs(estimated_offsets.get(channel, 0.0) - true_offset) > tolerance_s:
            return "missed"
    for channel, true_rate in truth_rates.items():
        if abs(estimated_rates.get(channel, 0.0) - true_rate) > tolerance_s:
            return "missed"
    return "matched"


def _std(values: list[float]) -> float:
    """计算样本标准差。"""
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    return math.sqrt(variance)


def _percentile(values: list[float], percentile: float) -> float:
    """计算百分位数；输入已排序或任意顺序。"""
    if not values:
        return 0.0
    ordered = sorted(values)
    index = math.ceil(len(ordered) * percentile) - 1
    return ordered[max(0, index)]
