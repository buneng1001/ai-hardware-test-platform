import json
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

from app.run_models import Artifact, BasicCheck, RunConfigurationSnapshot


def run_video_checks(artifacts: list[Artifact], data_dir: Path, snapshot: RunConfigurationSnapshot) -> list[BasicCheck]:
    """通过真实媒体文件输出统一视频检测结果。"""
    videos = [artifact for artifact in artifacts if artifact.kind == "video"]
    truth = _read_truth(artifacts, data_dir)
    probes = [_probe_video(data_dir / artifact.path, snapshot.video.fps) for artifact in videos]
    expected_frames = snapshot.video.fps * min(snapshot.duration_seconds, 5)
    dropped_by_channel = [expected_frames - probe["frame_count"] for probe in probes]
    fault = truth["faults"][0] if truth["faults"] else None
    detected_channel = next((index + 1 for index, dropped in enumerate(dropped_by_channel) if dropped > 0), None)
    detected_drops = dropped_by_channel[detected_channel - 1] if detected_channel else 0
    detected_window = probes[detected_channel - 1]["drop_windows"][0] if detected_channel else None
    drop_matched = bool(
        fault
        and detected_channel == fault["channel"]
        and detected_drops == fault["dropped_frames"]
        and detected_window
        and abs(detected_window["start_s"] - fault["start_s"]) < 1 / snapshot.video.fps
        and abs(detected_window["end_s"] - fault["end_s"]) < 1 / snapshot.video.fps
    )
    anomaly_windows = [{"channel": detected_channel, **detected_window}] if detected_channel and detected_window else []

    channel_count_passed = len(videos) == snapshot.video.channels
    codec_passed = len(probes) == len(videos) and all(probe["codec"] == "h264" for probe in probes)
    fps_passed = len(probes) == len(videos) and all(probe["fps"] == snapshot.video.fps for probe in probes)
    duration_passed = len(probes) == len(videos) and all(
        abs(probe["duration"] - min(snapshot.duration_seconds, 5)) <= 1 / snapshot.video.fps for probe in probes
    )
    corruption_passed = len(probes) == len(videos) and all(not probe["decode_error"] for probe in probes)
    if detected_channel and detected_window:
        drop_message = (
            f"第 {detected_channel} 路视频在 {detected_window['start_s']:.3f}～"
            f"{detected_window['end_s']:.3f} 秒"
            f"检测到 {detected_drops} 帧缺失"
        )
    else:
        drop_message = "所有视频帧数符合配置，未检测到掉帧"

    return [
        _result("video_channel_count", channel_count_passed, "视频路数符合配置", {"actual_channels": len(videos)}),
        _result("video_codec", codec_passed, "视频编码为 H.264", {"expected_codec": "h264"}),
        _result("video_frame_rate", fps_passed, "视频标称帧率符合配置", {"expected_fps": snapshot.video.fps}),
        _result(
            "video_duration",
            duration_passed,
            "视频时长符合配置",
            {"expected_duration_s": min(snapshot.duration_seconds, 5)},
        ),
        BasicCheck(
            name="video_frame_drop",
            status="failed" if detected_channel else "passed",
            message=drop_message,
            metrics={
                "channel": detected_channel or 0,
                "expected_frames": expected_frames,
                "actual_frames": expected_frames - detected_drops,
                "dropped_frames": detected_drops,
            },
            anomaly_windows=anomaly_windows,
            truth_comparison="matched" if drop_matched else ("missed" if fault else "not_applicable"),
        ),
        _result("video_corruption", corruption_passed, "视频可完整解码，未发现坏帧", {"decode_errors": 0}),
    ]


def _result(name: str, passed: bool, passed_message: str, metrics: dict[str, int | float | str]) -> BasicCheck:
    return BasicCheck(
        name=name,
        status="passed" if passed else "failed",
        message=passed_message if passed else f"{passed_message}检查失败",
        metrics=metrics,
    )


def _read_truth(artifacts: list[Artifact], data_dir: Path) -> dict:
    truth_artifact = next(artifact for artifact in artifacts if artifact.kind == "fault_truth")
    return json.loads((data_dir / truth_artifact.path).read_text(encoding="utf-8"))


def _probe_video(path: Path, expected_fps: int) -> dict[str, int | float | str | bool | None]:
    reader = imageio_ffmpeg.read_frames(path)
    try:
        metadata = next(reader)
    finally:
        reader.close()
    frame_count, duration = imageio_ffmpeg.count_frames_and_secs(path)
    decoded = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(path), "-f", "null", "-"],
        check=False,
        capture_output=True,
    )
    frame_times = _read_frame_times(path)
    frame_interval = 1 / expected_fps
    drop_windows = []
    for previous, current in zip(frame_times, frame_times[1:], strict=False):
        if current - previous > frame_interval * 1.5:
            drop_windows.append({"start_s": round(previous + frame_interval, 3), "end_s": round(current, 3)})
    return {
        "codec": metadata.get("codec"),
        "fps": metadata.get("fps"),
        "duration": duration,
        "frame_count": frame_count,
        "decode_error": decoded.returncode != 0 or bool(decoded.stderr.strip()),
        "drop_windows": drop_windows,
    }


def _read_frame_times(path: Path) -> list[float]:
    inspected = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "info", "-i", str(path), "-vf", "showinfo", "-f", "null", "-"],
        check=False,
        capture_output=True,
        text=True,
    )
    return [float(value) for value in re.findall(r"pts_time:([0-9.]+)", inspected.stderr)]
