# AI 智能硬件测试执行与诊断平台

这是一个完全洁净重写的本地面试作品。当前 Ticket 01 只提供可运行工程骨架：FastAPI 健康 API、React 状态页、
SQLite 可用性检查和 Mock CI 基线，不包含后续采集任务或诊断功能。

## 环境要求

- Python 3.12
- Node.js 24
- pnpm 11.19.0

## 首次安装

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -e "./backend[dev]"
pnpm install --frozen-lockfile
```

## 本地启动

在第一个终端启动后端：

```powershell
$env:APP_DATA_DIR = "data"
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --reload
```

在第二个终端启动前端：

```powershell
pnpm --dir frontend dev
```

打开 `http://127.0.0.1:5173`。页面会通过 `/api/health` 显示 FastAPI 和 SQLite 状态；数据库文件只写入被
Git 忽略的项目内 `data/`。首次健康检查会按 SQLite `user_version` 自动应用版本 1 迁移；后续迁移按版本顺序追加，
不会依赖外部数据库服务。

## 验证

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests
backend/.venv/Scripts/python.exe -m ruff check backend
backend/.venv/Scripts/python.exe -m ruff format --check backend
pnpm test
pnpm typecheck
pnpm format:check
pnpm --dir frontend build
python scripts/check_repository_safety.py
```

若出现 `spawn EPERM`、`CreateProcessAsUserW failed` 或缓存目录 `WinError 5`，这是 Windows 沙箱权限错误，
不是代码断言失败；应在允许创建子进程及项目缓存的终端重试。依赖安装失败应单独按网络或依赖错误排查。

## 安全边界

真实 `.env`、密钥、数据库和生成产物不会提交。仓库只提供空值示例；自动扫描之外，还必须按
[洁净重写与发布安全检查](docs/clean-room-checklist.md) 人工确认资产来源。
