import csv
import hashlib
import json
import math
import subprocess
from pathlib import Path

import imageio_ffmpeg

from app.run_models import Artifact, BasicCheck, RunConfigurationSnapshot


def generate_normal_artifacts(run_dir: Path, snapshot: RunConfigurationSnapshot) -> list[Artifact]:
    """使用公开格式真实生成正常场景的最小文件集。"""
    run_dir.mkdir(parents=True, exist_ok=False)
    video_path = run_dir / "camera_1.mp4"
    _generate_video(video_path, snapshot)
    _generate_imu(run_dir / "imu.csv", snapshot)
    _generate_device_status(run_dir / "device_status.csv")
    _generate_device_log(run_dir / "device.log")
    _generate_fault_truth(run_dir / "fault_truth.json", snapshot)

    return [
        _artifact("video", video_path, run_dir),
        _artifact("imu", run_dir / "imu.csv", run_dir),
        _artifact("device_status", run_dir / "device_status.csv", run_dir),
        _artifact("device_log", run_dir / "device.log", run_dir),
        _artifact("fault_truth", run_dir / "fault_truth.json", run_dir),
    ]


def run_basic_checks(artifacts: list[Artifact], data_dir: Path) -> list[BasicCheck]:
    required_kinds = {"video", "imu", "device_status", "device_log", "fault_truth"}
    actual_kinds = {artifact.kind for artifact in artifacts if artifact.size_bytes > 0}
    required_files_passed = actual_kinds == required_kinds
    video_artifact = next(artifact for artifact in artifacts if artifact.kind == "video")
    video_reader = imageio_ffmpeg.read_frames(data_dir / video_artifact.path)
    try:
        video_metadata = next(video_reader)
    finally:
        video_reader.close()
    video_h264_passed = video_metadata.get("codec") == "h264"
    normal_scenario_passed = required_files_passed and video_h264_passed
    return [
        BasicCheck(
            name="required_artifacts",
            status="passed" if required_files_passed else "failed",
            message="5 个必需产物均已生成" if required_files_passed else "必需产物缺失",
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


def _generate_video(path: Path, snapshot: RunConfigurationSnapshot) -> None:
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        f"testsrc2=size={snapshot.video.resolution}:rate={snapshot.video.fps}",
        "-t",
        str(snapshot.duration_seconds),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        str(path),
    ]
    subprocess.run(command, check=True, capture_output=True)


def _generate_imu(path: Path, snapshot: RunConfigurationSnapshot) -> None:
    sample_count = snapshot.duration_seconds * snapshot.imu.sample_rate_hz
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(["timestamp_s", "accel_x", "accel_y", "accel_z"])
        for index in range(sample_count):
            timestamp = index / snapshot.imu.sample_rate_hz
            writer.writerow([f"{timestamp:.3f}", f"{math.sin(timestamp):.6f}", "0.000000", "9.806650"])


def _generate_device_status(path: Path) -> None:
    path.write_text(
        "timestamp_s,cpu_percent,memory_percent,temperature_c,storage_free_mb\n"
        "0.000,18.0,32.0,40.0,8192\n1.000,20.0,32.5,40.5,8190\n2.000,19.0,33.0,41.0,8188\n",
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


def _artifact(kind: str, path: Path, run_dir: Path) -> Artifact:
    content = path.read_bytes()
    relative_path = Path("runs") / run_dir.name / path.name
    return Artifact(
        kind=kind,
        path=relative_path.as_posix(),
        source="actual_generated",
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )
