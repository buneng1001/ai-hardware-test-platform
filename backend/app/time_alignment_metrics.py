"""时间对齐指标、拟合和真值比较辅助函数。"""

import math
from typing import Literal

from app.run_models import RunConfigurationSnapshot


def _anchor_time(channel: str, timeline: list[tuple[float, float]]) -> float:
    """返回通道锚点时间：视频取最亮帧，IMU 取冲击峰值样本。"""
    return max(timeline, key=lambda sample: sample[1])[0]


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
