# AI 智能硬件测试执行与诊断平台

这是一个洁净重写的本地面试作品：用合成视频、IMU、设备状态和日志复现六类采集场景，由确定性检查器给出事实，再用 Mock 或硅基流动提供独立的结构化诊断。

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

命令不调用真实模型，会通过公开 HTTP API 实际生成文件、执行检查、生成诊断、导出 HTML 和 ZIP，证据写入被 Git 忽略的 `tmp/ticket20-acceptance`：

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

```powershell
$env:APP_DATA_DIR = "data"
$env:AI_DIAGNOSIS_MODE = "mock"
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --reload
pnpm --dir frontend dev
```

打开 `http://127.0.0.1:5173`。任务详情可以查看运行状态、人工结果、HTML 报告和 ZIP 证据包。

## 可选真实模型

Key 只放在后端环境变量，不提交 `.env`，前端临时输入只存在当前请求内存：

```powershell
$env:SILICONFLOW_API_KEY = "<your-key>"
$env:SILICONFLOW_MODEL = "Qwen/Qwen2.5-72B-Instruct"
$env:AI_DIAGNOSIS_MODE = "siliconflow"
```

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
