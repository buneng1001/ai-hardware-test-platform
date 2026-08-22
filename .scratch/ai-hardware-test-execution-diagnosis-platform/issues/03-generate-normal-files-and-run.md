# 03 — 生成正常场景文件并跑通首个运行记录

**What to build:** 让测试工程师从界面执行默认正常采集任务，创建不可覆盖的运行记录，真实生成首组可检查文件，并在运行详情中看到阶段、产物与成功结果。

**Blocked by:** 02 — 创建并查看采集任务

**Status:** resolved

- [x] 执行采集任务会创建带配置快照的新运行记录，重复执行不会覆盖已有记录。
- [x] 正常场景真实生成一路短 H.264 视频、一路 IMU、设备状态、设备日志和预先确定的故障真值。
- [x] 运行记录经历排队、生成数据、执行检查、汇总结果和已完成等合法阶段，并保留阶段事件。
- [x] 运行详情页可查看进度、阶段、产物清单、实际生成来源和基础检查结果。
- [x] 公开 API 主 seam 测试从创建任务驱动到已完成，并验证正常场景没有基础误报。
- [x] 更新课程映射中的合成数据、状态迁移和 API 主流程证据；工程日志记录真实生成或执行问题；面试案例只补充已验证的首个端到端运行。

## Answer

已通过公开 API seam 跑通“创建任务—执行—查看运行”：每次执行保存独立配置快照和五阶段事件，真实生成
H.264 MP4、IMU CSV、设备状态 CSV、设备日志及固定空故障真值，并完成必需产物、编码和正常场景基础检查。
页面展示完成进度、阶段、实际生成产物和检查结果。未读取或复用任何原公司代码、数据、Prompt、接口或文档。

### 验证证据（2026-08-22）

- `backend/.venv/Scripts/python.exe -m pytest -q`：7 passed。
- `backend/.venv/Scripts/python.exe -m ruff check app tests`：All checks passed。
- `backend/.venv/Scripts/python.exe -m ruff format --check app tests`：10 files already formatted。
- `pnpm test -- --run`：1 test file、5 tests passed。
- `pnpm typecheck`：通过，无 TypeScript 错误。
- `pnpm exec prettier --check src`：所有文件符合 Prettier 格式。
- `pnpm build`：Vite 生产构建成功，17 modules transformed。
- `backend/.venv/Scripts/python.exe scripts/check_repository_safety.py`：安全扫描通过。
- 真实 Uvicorn HTTP 冒烟：创建任务 201、执行运行 201、查询运行 200；状态为 `completed`，五阶段齐全，
  三项基础检查均通过。实际产物大小为 MP4 134611、IMU 3336、状态 151、日志 95、故障真值 113 字节。
- `$code-review` 以 `main...80bb489` 完成 Standards/Spec 双轴审查。课程映射超 120 字符问题已修复；
  详情页已补明确的 `5/5（100%）` 进度及测试。实时队列可观察性按 Ticket 05 边界未提前实现。

已知限制：当前仅支持固定快速正常场景和同步执行。可配置多路生成属于 Ticket 04；后台单执行队列、执行中轮询、
取消及异常中断恢复属于 Ticket 05；故障场景和完整检查器由后续 ticket 实现。
