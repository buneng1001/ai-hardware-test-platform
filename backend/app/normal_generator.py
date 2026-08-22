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
    BasicCheck,
    GenerationMetadata,
    RunConfigurationSnapshot,
)


def generate_normal_artifacts(
    run_dir: Path, snapshot: RunConfigurationSnapshot
) -> tuple[list[Artifact], GenerationMetadata]:
    """生成短媒体文件；长稳资源趋势使用虚拟时间控制成本。"""
    run_dir.mkdir(parents=True, exist_ok=False)
    actual_duration = min(snapshot.duration_seconds, MAX_ACTUAL_DURATION_SECONDS)
    video_paths = [
        run_dir / f"camera_{channel}.{snapshot.video.container}" for channel in range(1, snapshot.video.channels + 1)
    ]
    for channel, video_path in enumerate(video_paths, start=1):
        _generate_video(video_path, snapshot, actual_duration, channel)
    imu_path = run_dir / f"imu.{snapshot.imu.format}"
    _generate_imu(imu_path, snapshot, actual_duration)
    timeline_source = "virtual_time_simulated" if snapshot.duration_seconds > actual_duration else "actual_generated"
    _generate_device_status(run_dir / "device_status.csv", snapshot)
    _generate_device_log(run_dir / "device.log")
    _generate_fault_truth(run_dir / "fault_truth.json", snapshot)

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


def run_basic_checks(artifacts: list[Artifact], data_dir: Path, snapshot: RunConfigurationSnapshot) -> list[BasicCheck]:
    required_kinds = {"video", "imu", "device_status", "device_log", "fault_truth"}
    actual_kinds = {artifact.kind for artifact in artifacts if artifact.size_bytes > 0}
    video_count = sum(artifact.kind == "video" for artifact in artifacts)
    required_files_passed = actual_kinds == required_kinds and video_count == snapshot.video.channels
    video_artifacts = [artifact for artifact in artifacts if artifact.kind == "video"]
    video_h264_passed = all(_read_video_codec(data_dir / artifact.path) == "h264" for artifact in video_artifacts)
    normal_scenario_passed = required_files_passed and video_h264_passed
    return [
        BasicCheck(
            name="required_artifacts",
            status="passed" if required_files_passed else "failed",
            message=f"{video_count} 路视频及 4 类配套产物均已生成" if required_files_passed else "必需产物缺失",
        ),
        BasicCheck(
            name="video_h264",
            status="passed" if video_h264_passed else "failed",
            message="视频编码为 H.264" if video_h264_passed else "视频编码不是 H.264",
        ),
        BasicCheck(
            name="normal_scenario",
            status="passed" if normal_scenario_passed else "failed",
            message="正常场景未发现基础异常" if normal_scenario_passed else "正常场景存在基础异常",
        ),
    ]


def _generate_video(path: Path, snapshot: RunConfigurationSnapshot, actual_duration_seconds: int, channel: int) -> None:
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
        f"hue=h={(snapshot.random_seed + channel * 17) % 360}",
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
    command.extend(["-y", str(path)])
    subprocess.run(command, check=True, capture_output=True)


def _generate_imu(path: Path, snapshot: RunConfigurationSnapshot, actual_duration_seconds: int) -> None:
    sample_count = actual_duration_seconds * snapshot.imu.sample_rate_hz
    generator = random.Random(snapshot.random_seed)
    rows = []
    for index in range(sample_count):
        timestamp = index / snapshot.imu.sample_rate_hz
        rows.append(
            {
                "timestamp_s": f"{timestamp:.6f}",
                "accel_x": f"{math.sin(timestamp) + generator.uniform(-0.001, 0.001):.6f}",
                "accel_y": "0.000000",
                "accel_z": "9.806650",
            }
        )

    with path.open("w", encoding="utf-8", newline="") as file:
        if snapshot.imu.format == "csv":
            writer = csv.DictWriter(file, fieldnames=list(rows[0]), lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        else:
            for row in rows:
                file.write(json.dumps(row, separators=(",", ":")) + "\n")


def _generate_device_status(path: Path, snapshot: RunConfigurationSnapshot) -> None:
    duration = snapshot.duration_seconds
    midpoint = duration / 2
    end_temperature = 40.0 + duration * 0.1
    end_storage = max(0, 8192 - duration * 2)
    path.write_text(
        "timestamp_s,cpu_percent,memory_percent,temperature_c,storage_free_mb\n"
        f"0.000,18.0,32.0,40.0,8192\n{midpoint:.3f},20.0,35.0,{(40 + end_temperature) / 2:.1f},"
        f"{(8192 + end_storage) // 2}\n{duration:.3f},22.0,38.0,{end_temperature:.1f},{end_storage}\n",
        encoding="utf-8",
    )


def _generate_device_log(path: Path) -> None:
    path.write_text(
        "0.000 INFO collection started\n1.000 INFO collection healthy\n2.000 INFO collection completed\n",
        encoding="utf-8",
    )


def _generate_fault_truth(path: Path, snapshot: RunConfigurationSnapshot) -> None:
    truth = {
        "scenario": "normal",
        "random_seed": snapshot.random_seed,
        "faults": [],
        "expected_basic_result": "passed",
    }
    path.write_text(json.dumps(truth, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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


def _read_video_codec(path: Path) -> str | None:
    video_reader = imageio_ffmpeg.read_frames(path)
    try:
        return next(video_reader).get("codec")
    finally:
        video_reader.close()
