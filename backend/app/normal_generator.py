import csv
import hashlib
import json
import math
import random
import subprocess
from pathlib import Path

import imageio_ffmpeg

from app.run_models import (
    MAX_ACTUAL_DURATION_SECONDS,
    Artifact,
    GenerationMetadata,
    RunConfigurationSnapshot,
)
from app.video_generation import channel_delay_s, video_filter


def generate_normal_artifacts(
    run_dir: Path, snapshot: RunConfigurationSnapshot
) -> tuple[list[Artifact], GenerationMetadata]:
    """生成短媒体文件；长稳资源趋势使用虚拟时间控制成本。"""
    run_dir.mkdir(parents=True, exist_ok=False)
    actual_duration = _actual_duration_for_scenario(snapshot)
    fault_truth = _build_fault_truth(snapshot, actual_duration)
    truth_path = run_dir / "fault_truth.json"
    truth_path.write_text(json.dumps(fault_truth, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    video_paths = [
        run_dir / f"camera_{channel}.{snapshot.video.container}" for channel in range(1, snapshot.video.channels + 1)
    ]
    for channel, video_path in enumerate(video_paths, start=1):
        _generate_video(video_path, snapshot, actual_duration, channel, fault_truth)
    imu_path = run_dir / f"imu.{snapshot.imu.format}"
    _generate_imu(imu_path, snapshot, actual_duration, fault_truth)
    timeline_source = "virtual_time_simulated" if snapshot.duration_seconds > actual_duration else "actual_generated"
    _generate_device_status(run_dir / "device_status.csv", snapshot, fault_truth)
    _generate_device_log(run_dir / "device.log", snapshot, fault_truth)

    artifacts = [
        *[_artifact("video", video_path, run_dir) for video_path in video_paths],
        _artifact("imu", imu_path, run_dir),
        _artifact("device_status", run_dir / "device_status.csv", run_dir, timeline_source),
        _artifact("device_log", run_dir / "device.log", run_dir),
        _artifact("fault_truth", run_dir / "fault_truth.json", run_dir),
    ]
    fingerprint_input = "|".join(artifact.sha256 for artifact in artifacts)
    metadata = GenerationMetadata(
        timeline_source=timeline_source,
        requested_duration_seconds=snapshot.duration_seconds,
        generated_duration_seconds=actual_duration,
        reproducibility_fingerprint=hashlib.sha256(fingerprint_input.encode()).hexdigest(),
        temperature_range_c=(40.0, 40.0 + snapshot.duration_seconds * 0.1),
        storage_range_mb=(8192, max(0, 8192 - snapshot.duration_seconds * 2)),
    )
    return artifacts, metadata


def _generate_video(
    path: Path,
    snapshot: RunConfigurationSnapshot,
    actual_duration_seconds: int,
    channel: int,
    fault_truth: dict,
) -> None:
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        f"testsrc2=size={snapshot.video.resolution}:rate={snapshot.video.fps}",
        "-t",
        str(actual_duration_seconds),
        "-vf",
        video_filter(snapshot, channel, fault_truth, actual_duration_seconds),
        "-c:v",
        "libx264",
        "-fflags",
        "+bitexact",
        "-flags:v",
        "+bitexact",
        "-map_metadata",
        "-1",
        "-pix_fmt",
        "yuv420p",
    ]
    if snapshot.video.container == "mp4":
        command.extend(["-movflags", "+faststart"])
    if snapshot.scenario == "video_drop" and channel == fault_truth["faults"][0]["channel"]:
        command.extend(["-fps_mode", "vfr"])
    command.extend(["-y", str(path)])
    subprocess.run(command, check=True, capture_output=True)


def _generate_imu(
    path: Path,
    snapshot: RunConfigurationSnapshot,
    actual_duration_seconds: int,
    fault_truth: dict,
) -> None:
    sample_count = actual_duration_seconds * snapshot.imu.sample_rate_hz
    generator = random.Random(snapshot.random_seed)
    rows = []
    imu_delay_s = channel_delay_s(snapshot, "imu")
    spike_index: int | None = None
    if snapshot.scenario == "fixed_offset":
        # 冲击峰值的真实发生时刻为内容中点；加上 IMU 延迟后会出现在更晚的本地时间戳
        spike_time = actual_duration_seconds / 2
        spike_index = round(spike_time * snapshot.imu.sample_rate_hz)
    for index in range(sample_count):
        raw_timestamp = index / snapshot.imu.sample_rate_hz
        if snapshot.scenario == "fixed_offset" and index != spike_index:
            raw_timestamp += generator.uniform(-0.001, 0.001)
        timestamp = raw_timestamp + imu_delay_s
        accel_x = math.sin(timestamp) + generator.uniform(-0.001, 0.001)
        if index == spike_index:
            accel_x = 10.0
        rows.append(
            {
                "sample_index": index,
                "timestamp_s": f"{timestamp:.6f}",
                "accel_x": f"{accel_x:.6f}",
                "accel_y": "0.000000",
                "accel_z": "9.806650",
            }
        )

    if snapshot.scenario == "imu_anomaly":
        faults = {fault["type"]: fault for fault in fault_truth["faults"]}
        missing_index = faults["imu_missing_sample"]["sample_index"]
        rows = [row for row in rows if row["sample_index"] != missing_index]
        duplicate_index = faults["imu_duplicate_sample"]["sample_index"]
        duplicate_position = next(index for index, row in enumerate(rows) if row["sample_index"] == duplicate_index)
        rows.insert(duplicate_position + 1, rows[duplicate_position].copy())
        rollback_index = faults["imu_timestamp_rollback"]["sample_index"]
        rollback_row = next(row for row in rows if row["sample_index"] == rollback_index)
        rollback_row["timestamp_s"] = f"{(rollback_index - 2) / snapshot.imu.sample_rate_hz:.6f}"

    with path.open("w", encoding="utf-8", newline="") as file:
        if snapshot.imu.format == "csv":
            writer = csv.DictWriter(file, fieldnames=list(rows[0]), lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        else:
            for row in rows:
                file.write(json.dumps(row, separators=(",", ":")) + "\n")


def _actual_duration_for_scenario(snapshot: RunConfigurationSnapshot) -> int:
    """返回真实生成的媒体时长；存储不足场景提前停止以保留证据。"""
    raw = min(snapshot.duration_seconds, MAX_ACTUAL_DURATION_SECONDS)
    if snapshot.scenario == "storage_exhaustion":
        # 至少提前 1 秒停止，确保能观察到提前停止证据
        return max(1, raw - 1)
    return raw


def _generate_device_status(
    path: Path,
    snapshot: RunConfigurationSnapshot,
    fault_truth: dict,
) -> None:
    duration = snapshot.duration_seconds
    end_temperature = 40.0 + duration * 0.1
    header = "timestamp_s,cpu_percent,memory_percent,temperature_c,storage_free_mb\n"
    if snapshot.scenario != "storage_exhaustion":
        midpoint = duration / 2
        end_storage = max(0, 8192 - duration * 2)
        path.write_text(
            header
            + f"0.000,18.0,32.0,40.0,8192\n{midpoint:.3f},20.0,35.0,{(40 + end_temperature) / 2:.1f},"
            + f"{(8192 + end_storage) // 2}\n{duration:.3f},22.0,38.0,{end_temperature:.1f},{end_storage}\n",
            encoding="utf-8",
        )
        return

    fault = next(item for item in fault_truth["faults"] if item["type"] == "storage_exhaustion")
    threshold_mb = fault["threshold_mb"]
    stop_at_s = fault["stop_at_s"]
    warn_at_s = max(0.0, stop_at_s - 0.3)
    rows = [
        "0.000,18.0,32.0,40.0,8192",
        f"{warn_at_s:.3f},20.0,35.0,42.0,{threshold_mb + 200}",
        f"{stop_at_s:.3f},22.0,38.0,43.0,{threshold_mb - 100}",
        f"{duration:.3f},24.0,40.0,{end_temperature:.1f},0",
    ]
    path.write_text(header + "\n".join(rows) + "\n", encoding="utf-8")


def _generate_device_log(path: Path, snapshot: RunConfigurationSnapshot, fault_truth: dict) -> None:
    if snapshot.scenario != "storage_exhaustion":
        path.write_text(
            "0.000 INFO collection started\n1.000 INFO collection healthy\n2.000 INFO collection completed\n",
            encoding="utf-8",
        )
        return

    fault = next(item for item in fault_truth["faults"] if item["type"] == "storage_exhaustion")
    stop_at_s = fault["stop_at_s"]
    warn_at_s = max(0.0, stop_at_s - 0.3)
    path.write_text(
        f"0.000 INFO collection started\n"
        f"{warn_at_s:.3f} WARN storage low, only {fault['threshold_mb'] + 200} MB free\n"
        f"{stop_at_s:.3f} ERROR storage exhausted, recording stopped prematurely\n",
        encoding="utf-8",
    )


def _build_fault_truth(snapshot: RunConfigurationSnapshot, actual_duration_seconds: int) -> dict:
    truth: dict = {
        "scenario": snapshot.scenario,
        "random_seed": snapshot.random_seed,
        "faults": [],
        "expected_basic_result": "passed",
    }
    if snapshot.scenario == "video_drop":
        start_s = round(actual_duration_seconds * 0.4, 3)
        dropped_frames = max(1, round(snapshot.video.fps * actual_duration_seconds * 0.2))
        end_s = round(start_s + dropped_frames / snapshot.video.fps, 3)
        truth["faults"] = [
            {
                "type": "video_frame_drop",
                "channel": snapshot.random_seed % snapshot.video.channels + 1,
                "start_s": start_s,
                "end_s": end_s,
                "dropped_frames": dropped_frames,
            }
        ]
        truth["expected_basic_result"] = "video_frame_drop"
    elif snapshot.scenario == "imu_anomaly":
        missing_index = 20 + snapshot.random_seed % 10
        duplicate_index = 50 + (snapshot.random_seed // 10) % 10
        rollback_index = 80 + (snapshot.random_seed // 100) % 10
        truth["faults"] = [
            {
                "type": "imu_missing_sample",
                "sample_index": missing_index,
                "expected_check": "imu_missing_samples",
                "expected_status": "failed",
            },
            {
                "type": "imu_duplicate_sample",
                "sample_index": duplicate_index,
                "expected_check": "imu_duplicate_samples",
                "expected_status": "failed",
            },
            {
                "type": "imu_timestamp_rollback",
                "sample_index": rollback_index,
                "expected_check": "imu_timestamp_rollback",
                "expected_status": "failed",
            },
        ]
        truth["expected_interval_outlier_sample_indices"] = [
            missing_index + 1,
            duplicate_index,
            rollback_index,
            rollback_index + 1,
        ]
        truth["expected_basic_result"] = "imu_anomaly"
    elif snapshot.scenario == "storage_exhaustion":
        threshold_mb = 500
        truth["faults"] = [
            {
                "type": "storage_exhaustion",
                "threshold_mb": threshold_mb,
                "stop_at_s": float(actual_duration_seconds),
                "expected_checks": [
                    "storage_premature_stop",
                    "storage_exhaustion",
                    "storage_log_correlation",
                ],
                "expected_status": "failed",
            }
        ]
        truth["expected_basic_result"] = "storage_exhaustion"
    elif snapshot.scenario == "fixed_offset":
        truth["reference_channel"] = snapshot.reference_channel
        # 保存对齐时需要添加的校正量（延迟的相反数）
        truth["alignment_corrections_s"] = {
            f"camera_{channel}": -channel_delay_s(snapshot, channel)
            for channel in range(1, snapshot.video.channels + 1)
        }
        truth["alignment_corrections_s"]["imu"] = -channel_delay_s(snapshot, "imu")
        truth["expected_basic_result"] = "fixed_offset_aligned"
    return truth

def _artifact(kind: str, path: Path, run_dir: Path, source: str = "actual_generated") -> Artifact:
    content = path.read_bytes()
    relative_path = Path("runs") / run_dir.name / path.name
    return Artifact(
        kind=kind,
        path=relative_path.as_posix(),
        source=source,
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        codec="h264" if kind == "video" else None,
    )
