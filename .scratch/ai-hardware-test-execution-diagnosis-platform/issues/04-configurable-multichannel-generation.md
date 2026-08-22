# 04 — 扩展可配置的多通道合成文件生成

**What to build:** 让测试工程师通过界面配置完整的数据参数，生成 1～4 路视频和对应传感器文件，并用固定随机种子验证产物可重复，同时安全控制文件规模。

**Blocked by:** 03 — 生成正常场景文件并跑通首个运行记录

**Status:** resolved

- [x] 支持快速、标准和自定义模式，以及规格规定的时长、通道数、分辨率、帧率、容器、IMU 格式和采样率。
- [x] 视频使用 H.264，IMU 支持 CSV 和 JSONL，设备状态与日志随运行一起生成。
- [x] 固定随机种子的重复运行产生相同哈希或等价指标，并能查看用于验证的产物元数据。
- [x] 长稳趋势使用虚拟时间，报告和产物元数据明确区分实际生成与虚拟时间模拟。
- [x] 参数边界、非法组合和文件大小保护通过前后端及 API 主 seam 验证。
- [x] 更新课程映射中的数据驱动、边界值和文件处理证据；工程日志记录真实性与速度取舍；面试案例只补充已验证的多通道生成能力。

## Answer

已通过页面和公开 API seam 实现快速、标准、自定义配置，真实生成 1～4 路 H.264 MP4/MKV、CSV/JSONL
IMU、设备状态、日志和故障真值。相同种子重复运行的全部产物 SHA-256 与重复性指纹一致；300 秒请求保留
温升与存储虚拟趋势，只真实生成 5 秒媒体，并在 API 元数据与页面中明确来源。前后端在入队前拒绝超过
6 亿像素帧的组合，API 参数化测试覆盖规格枚举、上下界和非法值。

### 验证证据（2026-08-22）

- `backend/.venv/Scripts/python.exe -m pytest backend/tests -q`：29 passed。
- `backend/.venv/Scripts/python.exe -m ruff check backend/app backend/tests`：All checks passed。
- `backend/.venv/Scripts/python.exe -m ruff format --check backend/app backend/tests`：10 files already formatted。
- `pnpm --dir frontend test`：2 test files、8 tests passed。
- `pnpm --dir frontend typecheck`：通过，无 TypeScript 错误。
- `pnpm --dir frontend format:check`：所有文件符合 Prettier 格式。
- `pnpm --dir frontend build`：Vite 生产构建成功，18 modules transformed。
- `backend/.venv/Scripts/python.exe scripts/check_repository_safety.py`：安全扫描通过。
- `git diff --check`：通过，无空白错误。
- `$code-review` 以 `34060b6...8de9ebe` 完成 Standards/Spec 双轴并行审查；静默异常、长稳趋势证据、
  参数边界覆盖和逐路 H.264 验证均已修复并经双轴复核关闭。前后端独立规模校验仍有阈值同步维护成本，
  但两侧同一超限契约测试已覆盖，审查确认不阻塞。

已知限制：仍只生成正常采集场景；故障注入属于 Ticket 06～08 和 13。执行仍是同步 tracer bullet；后台队列、
取消与异常中断属于 Ticket 05。时间漂移与对齐、完整确定性检查器和独立导出报告由后续 ticket 实现。
