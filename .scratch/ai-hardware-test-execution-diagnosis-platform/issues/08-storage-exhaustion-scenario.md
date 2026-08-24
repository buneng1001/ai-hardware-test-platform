# 08 — 交付存储不足与提前停止场景

**What to build:** 让测试工程师从界面运行存储不足场景，通过文件、资源和日志证据识别录制提前停止，并看到确定性结论与故障真值一致。

**Blocked by:** 04 — 扩展可配置的多通道合成文件生成

**Status:** resolved

- [x] 场景在生成前记录存储阈值、提前停止位置和预期检测结果。
- [x] 系统生成可控的存储变化、提前结束文件和对应设备日志，不消耗不可控的真实磁盘空间。
- [x] 检查器关联文件完整性、时长、存储指标和日志事件，输出统一检测结果。
- [x] 分析视图展示提前停止事实、关联证据和故障真值对照。
- [x] API 主 seam 验证故障命中、证据关联及正常场景不误报。
- [x] 更新课程映射中的文件、资源和日志检查证据；工程日志记录真实保护或关联问题；面试案例只补充已验证的存储故障能力。

## Answer

已在前后端实现存储不足导致录制提前停止场景。生成器在写文件前把阈值 500 MB、提前停止位置和三项预期检查写入
fault_truth.json；通过缩短真实媒体时长模拟提前停止，device_status.csv 用可控虚拟趋势展示存储下降到阈值以下，
device.log 记录 storage low 与 recording stopped prematurely 事件，不消耗真实磁盘空间。

检查器新增 `storage_premature_stop`、`storage_exhaustion`、`storage_log_correlation`，从视频实际时长、设备状态存储
指标和日志事件三个维度输出统一结果。快速 2 秒场景真实生成 1 秒媒体，三项检查均失败且与故障真值对照为命中；同一任务
重复运行得到相同故障真值 SHA-256 和相同检测结果。正常场景 storage 检查全部通过且 `truth_comparison` 为
`not_applicable`，没有新增误报。

页面新增“存储不足”场景选项，运行详情展示存储检查的时长、阈值、最低空闲存储和日志关联事件数。

### 验证证据（2026-08-24）

- `backend/.venv/Scripts/python.exe -m pytest backend/tests -q`：47 passed。
- `backend/.venv/Scripts/python.exe -m ruff check backend/app backend/tests backend/conftest.py`：All checks passed。
- `backend/.venv/Scripts/python.exe -m ruff format --check backend/app backend/tests backend/conftest.py`：23 files already formatted。
- 前端 TypeScript 类型检查（`tsc -b --pretty false`）通过，Prettier 检查通过。
- `backend/.venv/Scripts/python.exe scripts/check_repository_safety.py`：安全扫描通过。
- `git diff --check`：通过，无空白错误。
- 前端 Vitest 与 Vite 生产构建在当前 Windows 沙箱下因 `spawn EPERM` 无法执行，已记录为环境限制。

### 代码审查

尝试使用 `$code-review` 启动并行子代理审查 Standards/Spec 双轴，但子代理在当前运行时下未能完成返回；改为作者自审：
移动 `imageio_ffmpeg` 导入到模块顶部、移除 `_generate_device_status` 未使用的 `actual_duration_seconds` 参数，
并修复 `video_checks.py` 对截断视频无掉帧窗口时的 `IndexError`。自审后 Ruff 与完整测试仍通过。

### 已知限制

- 当前只针对 `storage_exhaustion` 场景注入提前停止；通用资源告警检查由后续 ticket 扩展。
- 前端 Vitest/Vite 在当前沙箱下因进程派生限制无法运行，TypeScript 与 Prettier 已作为替代门禁。

