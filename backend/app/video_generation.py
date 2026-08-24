"""生成视频所需的固定偏移锚点和故障滤镜。"""

from app.run_models import RunConfigurationSnapshot


def channel_delay_s(snapshot: RunConfigurationSnapshot, channel: int | str) -> float:
    """返回固定偏移场景下通道相对参考时钟的延迟。"""
    if snapshot.scenario != "fixed_offset":
        return 0.0
    if channel == 1 or channel == "camera_1":
        return 0.0
    if isinstance(channel, int):
        # 视频延迟使用整数帧，避免共同事件落在帧间隔中间造成量化歧义。
        return round((channel - 1) / snapshot.video.fps, 6)
    return 0.08


def video_filter(
    snapshot: RunConfigurationSnapshot,
    channel: int,
    fault_truth: dict,
    actual_duration_seconds: int = 0,
) -> str:
    """返回正常、固定偏移或掉帧场景对应的 FFmpeg 滤镜。"""
    hue = f"hue=h={(snapshot.random_seed + channel * 17) % 360}"
    if snapshot.scenario == "fixed_offset" and actual_duration_seconds > 0:
        # 用白帧作为跨视频通道可检测的共同事件锚点。
        base_frame = round(actual_duration_seconds * snapshot.video.fps / 2)
        flash_frame = base_frame + channel - 1
        return f"{hue},drawbox=x=0:y=0:w=iw:h=ih:color=white@1.0:t=fill:enable='eq(n\\,{flash_frame})'"
    if snapshot.scenario != "video_drop" or channel != fault_truth["faults"][0]["channel"]:
        return hue
    fault = fault_truth["faults"][0]
    upper_bound = fault["end_s"] - 1 / (snapshot.video.fps * 100)
    return f"{hue},select=not(between(t\\,{fault['start_s']}\\,{upper_bound:.6f}))"
