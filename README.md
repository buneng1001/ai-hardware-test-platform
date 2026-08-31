# AI 智能硬件测试执行与诊断平台

这是一个洁净重写的本地面试作品：用合成视频、IMU、设备状态和日志复现六类采集场景，由确定性检查器给出事实，再用 Mock 或硅基流动提供独立的结构化诊断。

当前版本：`v0.1.0`（正式版），版本号记录在根目录 `VERSION`。

测试工程师使用流程见[测试工程师使用手册](docs/test-engineer-guide.md)，涵盖任务创建、实际测试 ZIP 导入、运行、人工结果、
诊断和证据导出。

## 环境准备

- Python 3.12
- Node.js 24
- pnpm 11.19.0
- 短视频生成使用项目依赖的 FFmpeg

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -e "./backend[dev]"
pnpm install --frozen-lockfile
```

## 一键 Mock 验收

RC2 ticket 08 的端到端验收不调用真实模型，会通过公开 FastAPI API 验证合成与导入链路、六轴 IMU、时间映射、
报告、证据 ZIP 和 Mock 诊断。证据写入被 Git 忽略的 `tmp/rc2-acceptance`：

```powershell
backend/.venv/Scripts/python.exe scripts/run_rc2_acceptance.py
backend/.venv/Scripts/python.exe scripts/check_artifact_safety.py tmp/rc2-acceptance
```

验收摘要位于 `tmp/rc2-acceptance/acceptance-summary.json`，Allure 兼容结果位于同目录的 `allure-results`。
脚本只生成公开格式的本地样例，不读取或保存用户实际测试数据和敏感凭据。

RC1 的历史回归验收仍可按以下命令运行；它不调用真实模型，会通过公开 HTTP API 生成文件、执行检查、生成诊断、导出 HTML 和 ZIP，
证据写入被 Git 忽略的 `tmp/ticket20-acceptance`：

```powershell
$env:AI_DIAGNOSIS_MODE = "mock"
backend/.venv/Scripts/python.exe scripts/run_ticket20_acceptance.py
backend/.venv/Scripts/python.exe scripts/check_artifact_safety.py tmp/ticket20-acceptance
```

验收覆盖正常、单路掉帧、IMU 异常、存储不足、温升关联组合故障和线性漂移六个场景；`fixed_offset` 与 `linear_drift` 额外验证两种对齐方法；快速、标准、自定义三种模式以及三种判定模式通过 API 验证。组合故障也可单独复现：

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_temperature_combination_api.py -q
```

## 本地启动

`.env.example` 是模板，不要把真实 API Key 写进这个文件。首次运行时复制一份为本机配置文件 `.env`，
再只修改 `.env`；`.env` 已被 Git 忽略，不会提交到仓库：

```powershell
Copy-Item .env.example .env
```

默认 Mock 模式不需要 API Key。后端和前端要分别占用两个终端窗口：

终端 1：启动后端。

```powershell
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --reload --env-file .env
```

终端 2：启动前端。

```powershell
pnpm --dir frontend dev
```

浏览器打开：

```text
http://127.0.0.1:5173
```

后端健康检查地址：

```text
http://127.0.0.1:8000/api/health
```

也可以不使用 `.env`，直接在当前 PowerShell 会话设置 Mock 模式：

```powershell
$env:APP_DATA_DIR = "data"
$env:AI_DIAGNOSIS_MODE = "mock"
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --reload
```

不要在已经运行 Uvicorn 的终端继续输入前端命令；请新开终端或 PyCharm 的新 Terminal 标签页。

<!--
启动命令拆成两个终端，后端终端不要继续输入前端命令。
-->

## 可选真实模型

如果要使用真实模型，编辑本机 `.env`，不要修改或提交 `.env.example`。Key 只放在后端环境变量，
前端临时输入只存在当前请求内存：

```dotenv
SILICONFLOW_API_KEY=
SILICONFLOW_MODEL=Qwen/Qwen2.5-72B-Instruct
AI_DIAGNOSIS_MODE=siliconflow
```

只在本机 `.env` 的 `SILICONFLOW_API_KEY` 等号后填写真实 Key，不要把 Key 写进 README 或 `.env.example`。

修改 `.env` 后重启后端，让 `--env-file .env` 重新加载配置。

模型失败不会阻断生成、确定性检查或原始报告；自动重试只覆盖超时、限流和临时服务错误，最多两次。本仓库没有真实 Key，也没有宣称真实线上模型效果已验证。

## 验证命令

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests -q
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_siliconflow_contract.py -q
backend/.venv/Scripts/python.exe -m ruff check backend scripts
backend/.venv/Scripts/python.exe -m ruff format --check backend scripts
pnpm test -- --run
pnpm typecheck
pnpm format:check
pnpm --dir frontend build
python scripts/check_repository_safety.py
```

## 产物和安全边界

`acceptance-summary.json` 记录真实运行的 ID、失败检查、诊断评估和产物数量；`normal-report.html` 与 `normal-evidence.zip` 用于独立复查。ZIP 默认不含原始视频，只含结构化结果、日志、清单、哈希和可选小样。Allure 兼容结果位于验收目录的 `allure-results`，GitHub Actions 会上传该目录及验收证据。

仓库安全扫描覆盖提交文件；验收产物使用 `check_artifact_safety.py` 扫描 HTML、ZIP、日志和 SQLite。资产来源仍需按 [洁净重写清单](docs/clean-room-checklist.md) 人工确认。

首版逐项证据见 [首版验收清单](docs/v1-acceptance-checklist.md)，真实状态映射见 [课程映射](docs/course-coverage.md)、[工程日志](docs/engineering-journal.md) 和 [面试案例](docs/interview-case.md)。
