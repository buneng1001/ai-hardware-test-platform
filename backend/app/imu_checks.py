import csv
import json
import math
from pathlib import Path

from app.artifact_io import read_fault_truth
from app.run_models import Artifact, BasicCheck, RunConfigurationSnapshot


def run_imu_checks(artifacts: list[Artifact], data_dir: Path, snapshot: RunConfigurationSnapshot) -> list[BasicCheck]:
    """从公开 IMU 产物计算采样完整性和时间戳质量。"""
    imu_artifact = next(artifact for artifact in artifacts if artifact.kind == "imu")
    rows = _read_rows(data_dir / imu_artifact.path, snapshot.imu.format)
    truth = read_fault_truth(artifacts, data_dir)
    expected_interval = 1 / snapshot.imu.sample_rate_hz
    indices = [int(row["sample_index"]) for row in rows]
    timestamps = [
        float(row["relative_timestamp_s"] if "relative_timestamp_s" in row else row["timestamp_s"])
        for row in rows
    ]
    intervals = [current - previous for previous, current in zip(timestamps, timestamps[1:], strict=False)]

    missing = [
        previous + offset
        for previous, current in zip(indices, indices[1:], strict=False)
        for offset in range(1, current - previous)
        if current > previous + 1
    ]
    duplicates = [current for previous, current in zip(indices, indices[1:], strict=False) if current == previous]
    rollbacks = [
        {"sample_index": indices[position], "timestamp_s": timestamps[position]}
        for position in range(1, len(timestamps))
        if timestamps[position] < timestamps[position - 1]
    ]
    positive_intervals = [interval for interval in intervals if interval > 0]
    actual_rate = 1 / _median(positive_intervals) if positive_intervals else 0.0
    interval_metrics, interval_anomalies = _interval_analysis(intervals, indices, timestamps, expected_interval)
    expected_interval_positions = truth.get("expected_interval_outlier_sample_indices", [])
    detected_interval_positions = [anomaly["sample_index"] for anomaly in interval_anomalies]
    interval_comparison = (
        "not_applicable"
        if not expected_interval_positions
        else ("matched" if expected_interval_positions == detected_interval_positions else "missed")
    )

    results = [
        _check(
            "imu_sample_rate",
            math.isclose(actual_rate, snapshot.imu.sample_rate_hz, rel_tol=0.01),
            "IMU 采样率符合配置",
            {"expected_rate_hz": snapshot.imu.sample_rate_hz, "actual_rate_hz": round(actual_rate, 3)},
        ),
        _anomaly_check("imu_missing_samples", "IMU 丢样", missing, truth),
        _anomaly_check("imu_duplicate_samples", "IMU 重复样本", duplicates, truth),
        _anomaly_check("imu_timestamp_rollback", "IMU 时间戳倒退", rollbacks, truth),
        BasicCheck(
            name="imu_interval_distribution",
            category="imu",
            status="failed" if interval_metrics["outlier_count"] else "passed",
            message=(
                f"IMU 采样间隔检测到 {interval_metrics['outlier_count']} 个异常"
                if interval_metrics["outlier_count"]
                else "IMU 采样间隔分布稳定"
            ),
            metrics=interval_metrics,
            anomaly_windows=interval_anomalies,
            truth_comparison=interval_comparison,
        ),
    ]
    if snapshot.scenario == "temperature_combination" and interval_anomalies:
        observed_gap = interval_anomalies[0]
        missing_check = next(check for check in results if check.name == "imu_missing_samples")
        missing_check.anomaly_windows = [
            {
                **observed_gap,
                "sample_index": missing[0],
                "start_s": round(float(observed_gap["timestamp_s"]) - observed_gap["interval_ms"] / 1000, 6),
                "end_s": observed_gap["timestamp_s"],
            }
        ]
    return results


def _read_rows(path: Path, imu_format: str) -> list[dict[str, str | int]]:
    with path.open(encoding="utf-8", newline="") as file:
        if imu_format == "csv":
            return list(csv.DictReader(file))
        return [json.loads(line) for line in file if line.strip()]


def _check(name: str, passed: bool, passed_message: str, metrics: dict[str, int | float | str]) -> BasicCheck:
    return BasicCheck(
        name=name,
        category="imu",
        status="passed" if passed else "failed",
        message=passed_message if passed else f"{passed_message}检查失败",
        metrics=metrics,
    )


def _anomaly_check(name: str, label: str, anomalies: list, truth: dict) -> BasicCheck:
    positions = [item if isinstance(item, dict) else {"sample_index": item} for item in anomalies]
    expected = [fault for fault in truth.get("faults", []) if fault.get("expected_check") == name]
    expected_positions = [fault["sample_index"] for fault in expected]
    detected_positions = [position["sample_index"] for position in positions]
    comparison = (
        "not_applicable" if not expected else ("matched" if expected_positions == detected_positions else "missed")
    )
    return BasicCheck(
        name=name,
        category="imu",
        status="failed" if positions else "passed",
        message=f"{label}检测到 {len(positions)} 处异常" if positions else f"未检测到{label}",
        metrics={"count": len(positions)},
        anomaly_windows=positions,
        truth_comparison=comparison,
    )


def _interval_analysis(
    intervals: list[float],
    indices: list[int],
    timestamps: list[float],
    expected: float,
) -> tuple[dict[str, int | float], list[dict[str, int | float]]]:
    sorted_intervals = sorted(intervals)
    p95_index = math.ceil(len(sorted_intervals) * 0.95) - 1
    outlier_positions = [
        position
        for position, interval in enumerate(intervals)
        if not math.isclose(interval, expected, abs_tol=expected * 0.1)
    ]
    metrics = {
        "expected_interval_ms": round(expected * 1000, 3),
        "minimum_interval_ms": round(min(intervals) * 1000, 3),
        "maximum_interval_ms": round(max(intervals) * 1000, 3),
        "mean_interval_ms": round(sum(intervals) / len(intervals) * 1000, 3),
        "p95_interval_ms": round(sorted_intervals[p95_index] * 1000, 3),
        "outlier_count": len(outlier_positions),
    }
    anomalies = [
        {
            "sample_index": indices[position + 1],
            "timestamp_s": timestamps[position + 1],
            "interval_ms": round(intervals[position] * 1000, 3),
        }
        for position in outlier_positions
    ]
    return metrics, anomalies


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2
