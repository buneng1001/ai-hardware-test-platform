"""时间线读取、逐帧映射和派生产物写入。"""

import csv
import hashlib
import json
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

from app.run_models import Artifact, FrameImuAlignmentSummary, RunConfigurationSnapshot, TimeAlignmentResult

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
