"""时间对齐公共入口，保持原有导入路径和函数签名不变。"""

# 兼容层只负责导出；算法、时间线读取和产物写入由内部实现模块承载。
from app.time_alignment_impl import (
    align_fixed_offset,
    align_imported_data,
    align_linear_drift,
)
from app.time_alignment_io import build_frame_imu_alignment

__all__ = [
    "align_fixed_offset",
    "align_imported_data",
    "align_linear_drift",
    "build_frame_imu_alignment",
]
