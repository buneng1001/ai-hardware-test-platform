from collections.abc import Mapping


IMU_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "sample_index": ("sample_index", "index", "序号"),
    "relative_timestamp_s": (
        "relative_timestamp_s",
        "relative_time",
        "timestamp_s",
        "time_s",
        "time",
        "timestamp",
        "elapsed_time",
        "device_time",
        "timestamp_ms",
        "time_ms",
        "timestamp_us",
        "time_us",
        "timestamp_ns",
        "time_ns",
    ),
    "raw_device_timestamp_ns": ("raw_device_timestamp_ns", "device_timestamp_ns"),
    "accel_x_m_s2": ("accel_x_m_s2", "accel_x", "ax"),
    "accel_y_m_s2": ("accel_y_m_s2", "accel_y", "ay"),
    "accel_z_m_s2": ("accel_z_m_s2", "accel_z", "az"),
    "gyro_x_rad_s": ("gyro_x_rad_s", "gyro_x", "gx"),
    "gyro_y_rad_s": ("gyro_y_rad_s", "gyro_y", "gy"),
    "gyro_z_rad_s": ("gyro_z_rad_s", "gyro_z", "gz"),
}


def normalize_imu_row(row: Mapping[str, object], index: int) -> dict[str, object]:
    normalized = dict(row)
    for canonical, aliases in IMU_FIELD_ALIASES.items():
        if canonical in normalized:
            continue
        source = next((alias for alias in aliases if alias in row), None)
        if source is not None:
            value = row[source]
            normalized[canonical] = (
                _time_in_seconds(value, source)
                if canonical == "relative_timestamp_s"
                else value
            )
    if "relative_timestamp_s" not in normalized:
        source = next(
            (
                name
                for name in row
                if "time" in name.lower() or "timestamp" in name.lower()
            ),
            None,
        )
        if source is not None:
            normalized["relative_timestamp_s"] = _time_in_seconds(row[source], source)
    normalized.setdefault("sample_index", index)
    return normalized


def _time_in_seconds(value: object, field_name: str) -> object:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return value
    name = field_name.lower()
    if name.endswith(("_ms", "ms")):
        return numeric / 1_000
    if name.endswith(("_us", "us")):
        return numeric / 1_000_000
    if name.endswith(("_ns", "ns")):
        return numeric / 1_000_000_000
    return numeric
