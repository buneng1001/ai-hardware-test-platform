"""多通道固定偏移时间对齐：估计偏移、保留原始证据并输出对齐前后指标。"""

import csv
import json
import math
import re
import subprocess
from pathlib import Path
from typing import Literal

import imageio_ffmpeg

from app.artifact_io import read_fault_truth
from app.run_models import Artifact, RunConfigurationSnapshot, TimeAlignmentResult


def align_fixed_offset(
    artifacts: list[Artifact], data_dir: Path, snapshot: RunConfigurationSnapshot
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

    reference_anchor = _anchor_time(reference_channel, all_channels[reference_channel])
    estimated_offsets_s = {
        channel: round(reference_anchor - _anchor_time(channel, timestamps), 3)
        for channel, timestamps in all_channels.items()
        if timestamps
    }

    pre_alignment = _pre_alignment_metrics(all_channels, estimated_offsets_s, reference_channel, snapshot)
    post_alignment = _post_alignment_residuals(
        all_channels, estimated_offsets_s, reference_anchor, reference_channel, snapshot
    )

    truth = read_fault_truth(artifacts, data_dir)
    truth_offsets = _relative_truth_offsets(truth.get("alignment_corrections_s", {}), reference_channel)
    truth_comparison = _compare_offsets(estimated_offsets_s, truth_offsets)

    return TimeAlignmentResult(
        reference_channel=reference_channel,
        method="fixed_offset_anchor",
        parameters=estimated_offsets_s,
        pre_alignment=pre_alignment,
        post_alignment=post_alignment,
        truth_comparison=truth_comparison,
    )


def align_linear_drift(
    artifacts: list[Artifact], data_dir: Path, snapshot: RunConfigurationSnapshot
) -> TimeAlignmentResult | None:
    """用多个共同事件拟合线性校正，保留每个通道的原始锚点序列。"""
    if snapshot.scenario != "linear_drift":
        return None

    video_timelines = _read_video_timelines(artifacts, data_dir)
    imu_timeline = _read_imu_timeline(artifacts, data_dir, snapshot.imu.format)
    channels = {**video_timelines, "imu": imu_timeline} if imu_timeline else video_timelines
    if snapshot.reference_channel not in channels:
        return None
    anchors = {channel: _anchor_times(channel, timeline) for channel, timeline in channels.items()}
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
    truth_drifts = _relative_truth_rates(
        truth.get("alignment_drift_rates_s_per_s", {}), snapshot.reference_channel
    )
    truth_comparison = _compare_linear_model(parameters, drift_rates, truth_offsets, truth_drifts)
    return TimeAlignmentResult(
        reference_channel=snapshot.reference_channel,
        method="linear_drift_regression",
        parameters=parameters,
        drift_rates_s_per_s=drift_rates,
        anchors=anchors,
        pre_alignment=pre_alignment,
        post_alignment=post_alignment,
        trend=trend,
        truth_comparison=truth_comparison,
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

    return [(float(row["timestamp_s"]), float(row["accel_x"])) for row in rows]


def _anchor_time(channel: str, timeline: list[tuple[float, float]]) -> float:
    """返回通道锚点时间：视频取最亮帧（闪光），IMU 取冲击峰值样本。"""
    return max(timeline, key=lambda sample: sample[1])[0]


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
) -> dict[str, dict[str, float]]:
    """应用估计偏移后，各通道相对参考锚点的残差分布。"""
    residuals: dict[str, dict[str, float]] = {}
    for channel, timeline in channels.items():
        correction = estimated_offsets_s.get(channel, 0.0)
        anchor_time = _anchor_time(channel, timeline)
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
