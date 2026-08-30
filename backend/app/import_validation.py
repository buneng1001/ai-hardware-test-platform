import csv
import hashlib
import json
import shutil
import stat
import zipfile
from pathlib import Path, PurePosixPath

from pydantic import ValidationError

from app.run_models import VideoConfiguration

MAX_ARCHIVE_BYTES = 2 * 1024**3
MAX_EXTRACTED_BYTES = 10 * 1024**3
MAX_FILE_COUNT = 100
MAX_FILE_BYTES = 5 * 1024**3
MAX_COMPRESSION_RATIO = 100
VALIDATOR_VERSION = "rc2-import-v1"


def validate_archive(archive_path: Path, extract_path: Path) -> dict[str, object]:
    """校验并解压实际测试 ZIP；错误发生时不创建正式数据目录。"""
    errors: list[str] = []
    warnings: list[str] = []
    security_errors: list[str] = []
    compatibility_errors: list[str] = []
    manifest: dict[str, object] | None = None
    try:
        if archive_path.stat().st_size > MAX_ARCHIVE_BYTES:
            security_errors.append("ZIP 文件超过 2GiB 限制")
        with zipfile.ZipFile(archive_path) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_FILE_COUNT:
                security_errors.append("ZIP 文件数量超过 100 个限制")
            total_size = 0
            for info in infos:
                path_error = _unsafe_member(info)
                if path_error:
                    security_errors.append(path_error)
                if info.file_size > MAX_FILE_BYTES:
                    security_errors.append(f"单文件超过 5GiB 限制：{info.filename}")
                total_size += info.file_size
                compression_ratio_exceeded = info.file_size and (
                    not info.compress_size or info.file_size / info.compress_size > MAX_COMPRESSION_RATIO
                )
                if compression_ratio_exceeded:
                    security_errors.append(f"压缩比超过 100:1：{info.filename}")
                if info.flag_bits & 0x1:
                    security_errors.append(f"不允许加密 ZIP 条目：{info.filename}")
            if total_size > MAX_EXTRACTED_BYTES:
                security_errors.append("ZIP 解压后超过 10GiB 限制")
            if security_errors:
                return _result("failed", security_errors, warnings, security_errors, [])
            manifest = _read_manifest(archive)
            archive.extractall(extract_path)
    except (OSError, zipfile.BadZipFile, RuntimeError, ValueError) as error:
        return _result("failed", [f"ZIP 文件损坏或不可读取：{error}"], warnings, [], [])

    if manifest is None:
        compatibility_errors.append("缺少 manifest.json")
    else:
        compatibility_errors.extend(_validate_manifest(manifest, extract_path))
        compatibility_errors.extend(_validate_imu(manifest, extract_path))
        if (extract_path / "fault_truth.json").exists():
            compatibility_errors.append("实际测试数据不得包含 fault_truth.json")
        optional = ("device-status.json", "device_status.json", "device.log", "device-log.json")
        if not any((extract_path / name).exists() for name in optional):
            warnings.append("缺少可选设备状态或设备日志")
        if not any(_is_supported_video(path) for path in extract_path.rglob("*")):
            compatibility_errors.append("至少需要一路 MP4/MKV 视频")
    if compatibility_errors:
        errors.extend(compatibility_errors)
    status_value = "passed" if not errors else "failed"
    if status_value == "passed" and manifest and manifest.get("schema_version") != "1.0":
        status_value = "nonstandard_convertible"
    return _result(
        status_value,
        errors,
        warnings,
        security_errors,
        compatibility_errors,
        manifest,
        _file_inventory(extract_path),
    )


def _is_supported_video(path: Path) -> bool:
    if not path.is_file() or path.suffix.lower() not in {".mp4", ".mkv"}:
        return False
    try:
        with path.open("rb") as source:
            header = source.read(8)
    except OSError:
        return False
    if path.suffix.lower() == ".mkv":
        return header == b"\x1a\x45\xdf\xa3"
    try:
        return header[4:8] == b"ftyp"
    except OSError:
        return False


def _file_inventory(extract_path: Path) -> list[dict[str, str | int]]:
    return [
        {
            "path": path.relative_to(extract_path).as_posix(),
            "size_bytes": path.stat().st_size,
            "sha256": _sha256_file(path),
        }
        for path in sorted(extract_path.rglob("*"))
        if path.is_file()
    ]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _unsafe_member(info: zipfile.ZipInfo) -> str | None:
    path = PurePosixPath(info.filename)
    if "\\" in info.filename or path.is_absolute() or ".." in path.parts:
        return f"检测到路径穿越：{info.filename}"
    if info.filename.endswith("/"):
        return None
    mode = (info.external_attr >> 16) & 0o170000
    if mode == stat.S_IFLNK:
        return f"不允许符号链接条目：{info.filename}"
    return None


def _read_manifest(archive: zipfile.ZipFile) -> dict[str, object] | None:
    try:
        return json.loads(archive.read("manifest.json"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError, TypeError):
        return None


def _validate_manifest(manifest: dict[str, object], extract_path: Path) -> list[str]:
    errors: list[str] = []
    videos = manifest.get("videos")
    if not isinstance(videos, list) or not 1 <= len(videos) <= 4:
        return ["manifest.videos 必须声明 1～4 路视频"]
    channels: set[str] = set()
    for video in videos:
        if not isinstance(video, dict):
            errors.append("manifest.videos 条目格式无效")
            continue
        required = (
            "channel",
            "path",
            "fps",
            "resolution",
            "bitrate_kbps",
            "time_source",
            "start_raw_device_timestamp_ns",
        )
        missing = [name for name in required if name not in video]
        if missing:
            errors.append(f"视频 manifest 缺少字段：{', '.join(missing)}")
        if video.get("codec") != "h264":
            errors.append(f"视频必须使用 H.264：{video.get('channel', 'unknown')}")
        channel = video.get("channel")
        if not isinstance(channel, str) or channel not in {f"camera_{index}" for index in range(1, 5)}:
            errors.append(f"视频通道名必须为 camera_1～camera_4：{channel}")
        elif channel in channels:
            errors.append(f"视频通道不能重复：{channel}")
        else:
            channels.add(channel)
        try:
            VideoConfiguration(
                channels=1,
                resolution=video.get("resolution"),
                fps=video.get("fps"),
                container=video.get("container"),
                codec=video.get("codec", "h264"),
                bitrate_kbps=video.get("bitrate_kbps"),
            )
        except (TypeError, ValueError, ValidationError):
            errors.append(f"视频参数不符合平台契约：{video.get('channel', 'unknown')}")
        path = _relative_path(video.get("path"))
        if path is None or path.suffix.lower() not in {".mp4", ".mkv"} or not (extract_path / path).is_file():
            errors.append(f"视频文件不存在或格式不支持：{video.get('path')}")
    imu = manifest.get("imu")
    if not isinstance(imu, dict) or imu.get("format") not in {"csv", "jsonl"}:
        errors.append("manifest.imu 必须声明 CSV 或 JSONL 格式")
    elif _relative_path(imu.get("path")) is None or not (extract_path / _relative_path(imu["path"])).is_file():
        errors.append(f"IMU 文件不存在：{imu.get('path')}")
    return errors


def _validate_imu(manifest: dict[str, object], extract_path: Path) -> list[str]:
    imu = manifest.get("imu")
    if not isinstance(imu, dict) or _relative_path(imu.get("path")) is None:
        return []
    path = extract_path / _relative_path(imu["path"])
    try:
        rows = list(_read_imu_rows(path, imu["format"]))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, csv.Error, ValueError) as error:
        return [f"IMU 文件无法读取：{error}"]
    if len(rows) < 2:
        return ["IMU 至少需要两个样本以验证采样率"]
    required = {
        "raw_device_timestamp_ns",
        "relative_timestamp_s",
        "accel_x_m_s2",
        "accel_y_m_s2",
        "accel_z_m_s2",
        "gyro_x_rad_s",
        "gyro_y_rad_s",
        "gyro_z_rad_s",
    }
    missing = required - set(rows[0])
    if missing:
        return [f"IMU 缺少六轴字段：{', '.join(sorted(missing))}"]
    timestamps = [float(row["relative_timestamp_s"]) for row in rows]
    duration = timestamps[-1] - timestamps[0]
    actual_rate = (len(rows) - 1) / duration if duration > 0 else 0
    if actual_rate < 100:
        return [f"IMU 采样率低于 100Hz：{actual_rate:.3f}Hz"]
    return []


def _read_imu_rows(path: Path, file_format: str) -> list[dict[str, object]]:
    if file_format == "csv":
        with path.open(encoding="utf-8", newline="") as source:
            return list(csv.DictReader(source))
    with path.open(encoding="utf-8") as source:
        return [json.loads(line) for line in source if line.strip()]


def _relative_path(value: object) -> Path | None:
    if not isinstance(value, str):
        return None
    if "\\" in value:
        return None
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        return None
    return Path(*path.parts)


def _result(
    status_value: str,
    errors: list[str],
    warnings: list[str],
    security_errors: list[str],
    compatibility_errors: list[str],
    manifest: dict[str, object] | None = None,
    files: list[dict[str, str | int]] | None = None,
) -> dict[str, object]:
    return {
        "status": status_value,
        "security": {"status": "passed" if not security_errors else "failed", "errors": security_errors},
        "compatibility": {
            "status": (
                "nonstandard_convertible"
                if status_value == "nonstandard_convertible"
                else "passed"
                if not compatibility_errors
                else "failed"
            ),
            "errors": compatibility_errors,
        },
        "errors": errors,
        "warnings": warnings,
        "manifest": manifest,
        "files": files or [],
    }


def remove_staging(path: Path) -> None:
    """手工清理失败或过期导入的隔离区。"""
    if path.exists():
        shutil.rmtree(path)
