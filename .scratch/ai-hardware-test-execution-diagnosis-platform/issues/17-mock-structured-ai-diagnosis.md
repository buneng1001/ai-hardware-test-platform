# 17 — 交付 Mock AI 结构化诊断

**What to build:** 让测试工程师在无 API Key 和无网络时，从失败运行生成受限诊断证据包，并获得可校验、可引用且可重复的 Mock 诊断运行。

**Blocked by:** 15 — 交付应用内报告与独立 HTML

**Status:** claimed

- [x] 诊断证据包从任务配置、阈值来源、失败指标、异常窗口日志、资源指标、关键帧、IMU 摘要和人工结果中限量选取证据。
- [x] 每条证据具有稳定引用编号，证据包同时受大小和 Token 上限约束。
- [x] 固定 Mock 返回结构化诊断，包含异常现象、可能原因、证据引用、置信级别、影响范围、复测建议、缺失证据和不确定性。
- [x] Schema 和证据引用校验会拒绝或标记无效输出，无证据内容只能显示为推测。
- [x] 每次诊断创建独立诊断运行，测试执行状态不因诊断成功或失败而变化。
- [x] API 主 seam 验证 Mock 成功、无效证据引用、重复诊断和报告展示。
- [x] 更新课程映射中的结构化 AI、Schema 和 Mock CI 证据；工程日志记录真实上下文或校验问题；面试案例只补充已验证的 Mock 诊断能力。

## Answer

- 实现了独立 `diagnosis_runs` SQLite 持久化、`POST/GET /api/runs/{id}/diagnoses` 和报告/运行详情展示。
- 证据包固定生成 `E001` 等引用，限制为 32 KiB 与 4,000 Token 估算；Mock 输出覆盖结构化诊断字段，越权引用返回 422，无证据原因标记为推测。
- 验证证据：`backend/.venv/Scripts/python.exe -m pytest tests/test_mock_diagnosis_api.py -q`（2 passed）；完整后端 Pytest 77 passed；Ruff、前端 TypeScript、Vitest 22 passed、Prettier 和 Vite build 均通过。前端在受限沙箱首次 `spawn EPERM`，提升权限重跑通过。
- 已知限制：本 ticket 不接入真实模型、重试或安全降级；关键帧只保留缺失证据说明，这些不属于 Ticket 17 的交付范围。
