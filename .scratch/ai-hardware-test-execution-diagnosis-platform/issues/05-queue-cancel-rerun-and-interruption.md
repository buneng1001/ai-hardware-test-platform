# 05 — 支持排队、取消、重新执行与异常中断识别

**What to build:** 让测试工程师安全管理多个运行记录，确保本机同时只有一个任务执行，并在取消、重新执行或应用重启后获得可信的运行状态。

**Blocked by:** 03 — 生成正常场景文件并跑通首个运行记录

**Status:** resolved

- [x] 同一时间只执行一个运行记录，其他运行按顺序排队且可观察。
- [x] 测试工程师可安全取消排队或执行中的运行，已产生证据按规则保留且状态为已取消。
- [x] 重新执行既有采集任务会创建新的运行记录和配置快照，不覆盖历史。
- [x] 应用重启后能识别未完成运行并标记异常中断，不误报为已完成或执行失败。
- [x] 状态迁移和公开 API 主 seam 覆盖排队、取消、重新执行与重启恢复。
- [x] 更新课程映射中的状态迁移和异常处理证据；工程日志记录真实并发或恢复问题；面试案例只补充已验证的运行管理能力。

## Answer

已通过单工作线程执行器跑通公开 API 驱动的运行管理链路：创建运行立即返回可观察的排队状态，后台按顺序执行；
排队和执行中的运行可取消，取消不会被工作线程覆盖，当前生成步骤安全收尾后保留已产生证据；重新执行从原配置
快照创建新运行记录；应用启动时把遗留非终态运行标记为异常中断。运行详情页面通过公开 API 轮询状态，并提供取消
和重新执行操作。实现保持洁净重写，未读取或复用任何原公司资产。

### 验证证据（2026-08-22）

- `backend/.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider --basetemp=.test-runs/ticket05-review-full
  backend/tests`：11 passed。
- `backend/.venv/Scripts/python.exe -m ruff check backend/app backend/tests`：All checks passed。
- `backend/.venv/Scripts/python.exe -m ruff format --check backend/app backend/tests`：12 files already formatted。
- `pnpm test -- --run`：2 个测试文件、6 tests passed。
- `pnpm typecheck`：通过，无 TypeScript 错误。
- `pnpm format:check`：所有前端文件符合 Prettier 格式。
- `pnpm --dir frontend build`：Vite 生产构建成功，18 modules transformed。
- `backend/.venv/Scripts/python.exe scripts/check_repository_safety.py`：安全扫描通过。
- `$code-review` 以 `34060b6...HEAD` 完成 Standards/Spec 双轴审查；测试文件超 300 行和状态联合类型重复已修复，
  最终验收闭环已补齐。功能实现未发现明确缺失、错误或 scope creep。

已知限制：取消采用协作式阶段边界收尾，正在运行的 FFmpeg 不会被强杀；取消状态立即可见，已生成证据会在当前步骤结束后
异步写回。首版仍只支持当前固定快速正常场景；多通道配置和故障场景属于其他 ticket。
