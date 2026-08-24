"""生成视频所需的固定偏移锚点和故障滤镜。"""

from app.run_models import RunConfigurationSnapshot


def channel_delay_s(
    snapshot: RunConfigurationSnapshot, channel: int | str, event_time_s: float = 0.0
) -> float:
    """返回时间对齐场景中通道相对参考时钟的事件延迟。"""
    if snapshot.scenario not in {"fixed_offset", "linear_drift"}:
        return 0.0
    if channel == 1 or channel == "camera_1":
        return 0.0
    if isinstance(channel, int):
        # 视频延迟使用整数帧，避免共同事件落在帧间隔中间造成量化歧义。
        base_delay = round((channel - 1) / snapshot.video.fps, 6)
    else:
        base_delay = 0.08
    if snapshot.scenario == "linear_drift":
        return base_delay + linear_drift_rate(snapshot, channel) * event_time_s
    return base_delay


def linear_drift_rate(snapshot: RunConfigurationSnapshot, channel: int | str) -> float:
    """返回合成时钟相对速率差，作为可复现的故障真值。"""
    if channel == 1 or channel == "camera_1":
        return 0.0
    if isinstance(channel, int):
        return (channel - 1) * 0.01
    return 0.04


def video_filter(
    snapshot: RunConfigurationSnapshot,
    channel: int,
    fault_truth: dict,
    actual_duration_seconds: int = 0,
) -> str:
    """返回正常、固定偏移或掉帧场景对应的 FFmpeg 滤镜。"""
    hue = f"hue=h={(snapshot.random_seed + channel * 17) % 360}"
    if snapshot.scenario in {"fixed_offset", "linear_drift"} and actual_duration_seconds > 0:
        # 用白帧作为跨视频通道可检测的共同事件锚点。
        event_times = (
            [actual_duration_seconds / 2]
            if snapshot.scenario == "fixed_offset"
            else [actual_duration_seconds * fraction for fraction in (0.2, 0.5, 0.8)]
        )
        flash_frames = [
            round((event_time + channel_delay_s(snapshot, channel, event_time)) * snapshot.video.fps)
            for event_time in event_times
        ]
        enable = "+".join(f"eq(n\\,{frame})" for frame in flash_frames)
        return f"{hue},drawbox=x=0:y=0:w=iw:h=ih:color=white@1.0:t=fill:enable='{enable}'"
    if snapshot.scenario not in {"video_drop", "temperature_combination"}:
        return hue
    fault = next(item for item in fault_truth["faults"] if item["type"] == "video_frame_drop")
    if channel != fault["channel"]:
        return hue
    upper_bound = fault["end_s"] - 1 / (snapshot.video.fps * 100)
    return f"{hue},select=not(between(t\\,{fault['start_s']}\\,{upper_bound:.6f}))"
