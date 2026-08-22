# 02 — 创建并查看采集任务

**What to build:** 让测试工程师通过新建任务页面创建“快速正常采集”任务，将配置持久化，并能重新打开查看，为首次执行提供一个完整但窄的任务配置入口。

**Blocked by:** 01 — 建立可运行的洁净工程骨架

**Status:** resolved

- [x] 新建任务页面提供首个快速正常采集配置，并通过公开 API 保存采集任务。
- [x] 已保存的采集任务可通过列表或详情重新查看，页面刷新后数据仍存在。
- [x] 前后端共同校验首个配置契约，非法输入不会持久化，并向用户返回可理解的错误。
- [x] API 集成测试覆盖创建、查询和非法输入，不依赖数据库内部表结构。
- [x] 更新课程映射中的接口联调、边界值和状态迁移证据；工程日志记录真实契约问题；面试案例只补充已完成的采集任务能力。

## Answer

已实现固定为 `quick` 模式和 `normal` 场景的首个采集任务契约。测试工程师可在页面填写任务名称，通过
`POST /api/collection-tasks` 保存 `draft` 任务，并通过列表或详情 API 重新查看。SQLite schema 版本升级为 2，
页面重新加载时从公开列表 API 恢复任务，不依赖前端内存。未实现运行记录、任务执行、数据生成或更多配置场景。

### 验证证据（2026-08-22）

- `backend/.venv/Scripts/python.exe -m pytest backend/tests -p no:cacheprovider`：6 passed；覆盖创建、详情、列表和
  名称、mode、scenario 三类非法输入，断言只通过公开 API 观察且非法请求后列表为空。
- `backend/.venv/Scripts/python.exe -m ruff check backend scripts`：All checks passed。
- `backend/.venv/Scripts/python.exe -m ruff format --check backend scripts`：7 files already formatted。
- `pnpm test`：1 test file、4 tests passed；覆盖状态页、创建后查看、刷新恢复和前端空白名称校验。
- `pnpm typecheck`：通过，无 TypeScript 错误。
- `pnpm format:check`：All matched files use Prettier code style。
- `pnpm --dir frontend build`：Vite 生产构建成功，17 modules transformed。
- `python scripts/check_repository_safety.py`：未发现常见密钥形态或高风险文件。
- 真实 Uvicorn 监听 `127.0.0.1:8766` 后，创建虚构任务返回 HTTP 201，列表查询返回 HTTP 200 和同一条
  `draft` 任务；验证后已停止服务。
- `$code-review` 以 `main...HEAD` 完成 Standards/Spec 双轴审查：Standards 0 项；Spec 发现非法 mode/scenario
  测试缺口，已补参数化 API 测试和中文错误，修复后完整验收再次通过。

已知限制：当前页面只有快速正常采集这一条窄配置；完整参数、自定义场景、运行记录、执行队列和状态迁移属于
后续 ticket。自动化 HTTP 测试验证页面公开 API 契约，尚未引入真实浏览器端到端测试框架。
