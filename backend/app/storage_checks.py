"""存储不足场景的确定性检查：文件提前停止、资源指标和日志事件关联。"""

import csv
from pathlib import Path

import imageio_ffmpeg

from app.artifact_io import read_fault_truth
from app.run_models import Artifact, BasicCheck, RunConfigurationSnapshot


def run_storage_checks(
    artifacts: list[Artifact], data_dir: Path, snapshot: RunConfigurationSnapshot
) -> list[BasicCheck]:
    """从公开产物关联文件完整性、存储指标和日志事件。"""
    truth = read_fault_truth(artifacts, data_dir)
    fault = next((item for item in truth["faults"] if item["type"] == "storage_exhaustion"), None)
    expected_checks = set(fault["expected_checks"]) if fault else set()

    status_path = data_dir / next(artifact.path for artifact in artifacts if artifact.kind == "device_status")
    log_path = data_dir / next(artifact.path for artifact in artifacts if artifact.kind == "device_log")
    video_artifacts = [artifact for artifact in artifacts if artifact.kind == "video"]

    premature = _premature_stop_check(video_artifacts, data_dir, snapshot, fault)
    exhaustion = _storage_exhaustion_check(status_path, fault)
    correlation = _log_correlation_check(log_path, fault)

    for check in (premature, exhaustion, correlation):
        if check.name in expected_checks:
            check.truth_comparison = "matched" if check.status == "failed" else "missed"

    return [premature, exhaustion, correlation]


def _premature_stop_check(
    video_artifacts: list[Artifact],
    data_dir: Path,
    snapshot: RunConfigurationSnapshot,
    fault: dict | None,
) -> BasicCheck:
    requested = snapshot.duration_seconds
    actual_duration = _probe_actual_video_duration(video_artifacts, data_dir)
    stopped_early = actual_duration < requested - 1 / snapshot.video.fps
    stop_at_s = fault["stop_at_s"] if fault else None
    matched = bool(fault and stopped_early and abs(actual_duration - stop_at_s) <= 1 / snapshot.video.fps)
    return BasicCheck(
        name="storage_premature_stop",
        category="storage",
        status="failed" if stopped_early else "passed",
        message=(
            f"视频在 {actual_duration:.3f} 秒提前停止，低于请求的 {requested} 秒"
            if stopped_early
            else "视频时长达到请求值，未检测到提前停止"
        ),
        metrics={
            "requested_duration_s": requested,
            "actual_duration_s": round(actual_duration, 3),
            "expected_stop_at_s": stop_at_s if stop_at_s else "not_applicable",
        },
        truth_comparison="matched" if matched else ("missed" if fault else "not_applicable"),
    )


def _probe_actual_video_duration(video_artifacts: list[Artifact], data_dir: Path) -> float:
    if not video_artifacts:
        return 0.0
    # 多路视频应同时停止，取第一路实际时长作为代表
    _, duration = imageio_ffmpeg.count_frames_and_secs(data_dir / video_artifacts[0].path)
    return float(duration)


def _storage_exhaustion_check(status_path: Path, fault: dict | None) -> BasicCheck:
    rows = _read_csv_rows(status_path)
    free_values = [int(row["storage_free_mb"]) for row in rows if row.get("storage_free_mb", "").lstrip("-").isdigit()]
    threshold_mb = fault["threshold_mb"] if fault else 500
    breached = any(value < threshold_mb for value in free_values)
    minimum_free = min(free_values) if free_values else 0
    return BasicCheck(
        name="storage_exhaustion",
        category="storage",
        status="failed" if breached else "passed",
        message=(
            f"设备存储最低降至 {minimum_free} MB，低于阈值 {threshold_mb} MB"
            if breached
            else f"设备存储未低于阈值 {threshold_mb} MB"
        ),
        metrics={
            "threshold_mb": threshold_mb,
            "minimum_free_mb": minimum_free,
            "breached": int(breached),
        },
        truth_comparison="not_applicable",
    )


def _log_correlation_check(log_path: Path, fault: dict | None) -> BasicCheck:
    lines = log_path.read_text(encoding="utf-8").splitlines()
    matched = [line for line in lines if "storage" in line.lower() or "exhausted" in line.lower()]
    return BasicCheck(
        name="storage_log_correlation",
        category="storage",
        status="failed" if matched else "passed",
        message=(f"设备日志中找到 {len(matched)} 条存储相关事件" if matched else "设备日志中未找到存储相关事件"),
        metrics={"matched_event_count": len(matched)},
        truth_comparison="not_applicable",
    )


def _read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as file:
        return list(csv.DictReader(file))
