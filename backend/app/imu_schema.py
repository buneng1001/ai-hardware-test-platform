from collections.abc import Mapping


IMU_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "sample_index": ("sample_index", "index", "序号"),
    "relative_timestamp_s": ("relative_timestamp_s", "timestamp_s", "time", "timestamp"),
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
            normalized[canonical] = row[source]
    normalized.setdefault("sample_index", index)
    return normalized
