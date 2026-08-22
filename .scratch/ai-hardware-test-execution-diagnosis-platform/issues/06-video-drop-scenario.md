# 06 — 交付单路视频掉帧场景

**What to build:** 让测试工程师从界面运行固定种子的单路视频掉帧场景，并从统一检测结果中看到视频异常、异常时间窗口和故障真值对照。

**Blocked by:** 04 — 扩展可配置的多通道合成文件生成

**Status:** resolved

- [x] 场景在生成前记录掉帧故障真值、注入位置和预期检测结果。
- [x] 视频检查覆盖路数、编码、帧率、时长、掉帧和坏帧，并输出统一检测结果。
- [x] 运行详情或分析视图展示失败指标、异常时间窗口及其故障真值对照。
- [x] 固定种子重复运行得到等价故障，正常场景不因新增检查器产生误报。
- [x] API 主 seam 验证场景执行、检测命中和结果展示，不依赖检查器内部实现。
- [x] 更新课程映射中的视频检查与参数化测试证据；工程日志记录真实媒体检查问题；面试案例只补充已验证的掉帧检测能力。

## Answer

已从页面和公开 API 主 seam 交付固定种子的单路视频掉帧场景。生成器在真实媒体生成前记录目标通道、
`0.800～1.200` 秒注入窗口、6 帧缺失和预期检测结果；检查器读取实际视频帧数、编码、帧率、时长与
逐帧 PTS，并通过完整解码检查坏帧。快速场景从预期 30 帧中检测到第 1 路实际 24 帧，异常窗口来自媒体
PTS 间隙，故障真值对照为 `matched`。相同种子重复运行得到相同检测结果与故障真值哈希，正常场景六项
视频检查均通过。运行详情展示失败指标、异常时间窗口和故障真值对照。

### 验证证据（2026-08-23）

- `backend/.venv/Scripts/python.exe -m pytest backend/tests -q -p no:cacheprovider
  --basetemp=.test-runs/ticket06-review-full`：36 passed。
- `backend/.venv/Scripts/python.exe -m ruff check backend/app backend/tests`：All checks passed。
- `backend/.venv/Scripts/python.exe -m ruff format --check backend/app backend/tests`：13 files already formatted。
- `pnpm --dir frontend test`：3 test files、11 tests passed。
- `pnpm --dir frontend typecheck`：通过，无 TypeScript 错误。
- `pnpm --dir frontend format:check`：所有文件符合 Prettier 格式。
- `pnpm --dir frontend build`：Vite 生产构建成功，19 modules transformed。
- `backend/.venv/Scripts/python.exe scripts/check_repository_safety.py`：安全扫描通过。
- `git diff --check`：通过，无空白错误。
- `$code-review` 以 `64ef5e8...80aa1af` 完成 Standards/Spec 双轴并行审查；真实时长上限复用和
  API 参数化证据问题已修复，并经两个审查轴复核确认无阻塞项。

已知限制：当前检测结果类别只包含视频；IMU、存储、温度组合故障及跨证据检查属于后续 Ticket 07、08
和 13。`normal_generator.py` 的名称仍带有早期正常场景语义，待更多场景进入同一生成模块时再做场景中性
重命名，避免本 ticket 扩大改动范围。
