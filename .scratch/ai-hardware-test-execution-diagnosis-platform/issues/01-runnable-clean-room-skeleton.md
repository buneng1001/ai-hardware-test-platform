# 01 — 建立可运行的洁净工程骨架

**What to build:** 让测试工程师能够在本机启动前后端，打开平台状态页，并通过公开 API 验证服务与本地数据库可用，形成后续垂直切片都能复用的最小运行和测试基线。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] FastAPI 后端、React/TypeScript 前端和 SQLite 可按统一说明在本机启动，前端使用 pnpm 管理依赖。
- [x] 浏览器能显示后端健康状态，公开健康 API 和前端页面均有外部行为测试。
- [x] Pytest、前端测试、格式检查和 GitHub Actions Mock 基线可运行，并区分代码、环境、依赖和沙箱错误。
- [x] 建立 UTF-8、换行、忽略文件、环境变量示例、项目内数据目录和敏感信息检查基线。
- [x] 仓库不包含真实密钥、公司资产或旧项目内容，日志和示例配置不泄露敏感信息。
- [x] 更新课程映射的工程骨架与 CI 状态及证据；工程日志记录真实搭建问题和验证；面试案例只补充已验证的启动与安全基线。

## Answer

已从洁净空仓库建立 Ticket 01 的最小端到端骨架：FastAPI `GET /api/health` 通过版本化迁移后的真实
SQLite 查询报告状态，React 状态页消费公开 API，pnpm 锁定前端依赖，并建立 Mock CI、编码、换行、项目内
数据目录、空环境变量示例、洁净重写清单和仓库安全扫描。未实现任何后续 ticket 的任务、执行或诊断功能。

### 验证证据（2026-08-22）

- `backend/.venv/Scripts/python.exe -m pytest backend/tests -p no:cacheprovider`：1 passed。
- `backend/.venv/Scripts/python.exe -m ruff check backend scripts`：All checks passed。
- `backend/.venv/Scripts/python.exe -m ruff format --check backend scripts`：5 files already formatted。
- `pnpm test`：1 test file、1 test passed。
- `pnpm typecheck`：通过，无 TypeScript 错误。
- `pnpm format:check`：All matched files use Prettier code style。
- `pnpm --dir frontend build`：Vite 生产构建成功，16 modules transformed。
- `python scripts/check_repository_safety.py`：未发现常见密钥形态或高风险文件；公司资产来源另按人工清单复核。
- Uvicorn 监听 `127.0.0.1:8765` 后请求 `GET /api/health`：HTTP 200，响应
  `{"status":"ok","database":"ok"}`，验证后已停止进程。
- `$code-review` 以 `main...HEAD` 完成 Standards/Spec 双轴审查；修复了安全日志、生成文件忽略、SQLite
  迁移基线及 Prettier 构建产物忽略问题，修复后完整验收再次通过。

已知限制：GitHub Actions Mock 工作流已配置，且其中各本地等价命令通过；当前未推送分支，因此没有虚构远端
CI 运行记录。真实密钥、公司资产和旧项目内容未被读取或复用，自动扫描不能替代人工权属确认。
