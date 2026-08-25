# 20 — 完成可复现交付与首版验收

**What to build:** 让新用户能够按照说明在 Mock 模式复现正常与组合故障演示，并用自动化证据逐项验证首版功能、安全边界和作品叙事。

**Blocked by:** 05 — 支持排队、取消、重新执行与异常中断识别；16 — 交付可校验的 ZIP 证据包；18 — 接入硅基流动并实现安全降级；19 — 交付 AI 效果评估与仪表盘闭环

**Status:** resolved

- [x] README 覆盖环境准备、一键启动、Mock 演示、可选真实模型配置、正常场景和组合故障场景。
- [x] GitHub Actions 已配置后端、前端、契约、公开 API 主 seam、Mock 模式测试和 Allure 结果上传；远端 run `32834997831` 已成功。
- [x] 本地验收脚本已实际验证六个场景、三种数据模式、两种对齐方法、三种判定模式、人工结果、诊断降级、HTML 和 ZIP。
- [x] 首版验收清单逐项链接到测试、CI、报告或演示产物，并明确标出未验证能力。
- [x] 本地仓库、日志、数据库、HTML、ZIP 和 CI artifact 已通过密钥、敏感字段和公司资产扫描。
- [x] 课程映射、工程日志和面试案例已更新；量化运行数据来自 `acceptance-summary.json`。

## Answer

已完成 Ticket 20 的本地可复现交付实现。`scripts/run_ticket20_acceptance.py` 通过公开 API 实际生成六个场景，
并将运行 ID、失败检查、故障真值对照、诊断评估、模式、对齐、人工结果、HTML 和 ZIP 结果写入验收摘要。
`scripts/check_artifact_safety.py` 扫描验收目录中的 HTML、ZIP、SQLite 和日志；CI 使用固定版本
`allure-pytest` 生成自动化测试结果并上传验收目录。

### 验证证据

- `backend/.venv/Scripts/python.exe scripts/run_ticket20_acceptance.py --output tmp/ticket20-acceptance-review`：
  六场景完成，正常场景无误报，故障场景真值命中，quick/standard/custom、两种对齐和三种判定模式通过；
  产物摘要见 `tmp/ticket20-acceptance-review/acceptance-summary.json`。
- `backend/.venv/Scripts/python.exe scripts/check_artifact_safety.py tmp/ticket20-acceptance-review`：64 个产物通过。
- `backend/.venv/Scripts/python.exe -m pytest backend/tests -q -p no:cacheprovider`：98 passed。
- `pnpm --dir frontend test -- --run`：24 passed；typecheck、format、build 通过。
- `backend/.venv/Scripts/python.exe -m ruff check backend scripts`、脚本格式检查和 `git diff --check` 通过。

### 未验证边界

- 本地没有真实硅基流动 API Key，因此真实线上模型效果未验证。
- 真实硅基流动线上调用和模型效果仍未验证；CI 仅验证 Mock 模式和安全降级。
