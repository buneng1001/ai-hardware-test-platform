# 10 — 交付线性漂移时间对齐

**What to build:** 让测试工程师运行多路时间戳漂移场景，使用多个共同事件估计线性漂移，并查看对齐前漂移与对齐后残差分布。

**Blocked by:** 09 — 交付固定偏移时间对齐

**Status:** resolved

- [x] 多路时间戳漂移场景在生成前记录偏移、漂移参数和预期结果。
- [x] 系统使用多个共同事件执行线性漂移校正，不引入非线性时间扭曲。
- [x] 分析视图展示对齐前漂移及对齐后最大值、平均值、P95 和趋势。
- [x] 原始时间戳、对齐前指标、校正参数和对齐后结果分别保存并可追溯。
- [x] 已知漂移参数的契约测试与 API 主 seam 验证估计精度和残差改善。
- [x] 更新课程映射中的多通道漂移分析证据；工程日志记录真实估计或数值问题；面试案例只补充已验证的线性漂移校正能力。

## Answer

- 新增 `linear_drift` 场景：生成前记录各通道偏移、漂移率、三个共同事件和预期真值；视频闪光与 IMU 冲击峰值均使用合成数据。
- 新增多事件线性回归对齐结果，保存原始锚点、对齐前偏移/抖动/漂移率、截距、漂移率、对齐后最大值/平均值/P95 和趋势。
- 运行详情页面新增线性漂移场景、漂移率、前后残差趋势展示；固定偏移场景保持单事件行为不变。
- 验证证据：
  - `backend\\.venv\\Scripts\\python.exe -m pytest backend\\tests -q --disable-warnings` → 52 passed；
  - `backend\\.venv\\Scripts\\python.exe -m ruff check backend` → All checks passed；
  - `pnpm --dir frontend test`（提升权限环境）→ 5 files / 18 tests passed；
  - `pnpm --dir frontend typecheck` → passed；
  - `pnpm --dir frontend format:check` → passed；
  - `git diff --check` → passed。
- 线性漂移 API seam 实测：四路视频识别三个共同事件，camera_4 漂移率约 `-0.03 s/s`，最大残差由约 `233.333 ms` 降至约 `11.111 ms`，故障真值对照为 `matched`。
- Code review：Standards 无硬性问题；Spec 发现的漂移率展示和锚点健壮性问题已修复。
- 已知限制：时间戳对齐与画面内容同步仍是独立能力；本 ticket 未实现内容同步检查，也未引入复杂非线性时间扭曲。

