# 19 — 交付 AI 效果评估与仪表盘闭环

**What to build:** 让测试工程师用六个内置场景的故障真值评价诊断质量，并从仪表盘快速查看运行、失败、诊断和评估状态。

**Blocked by:** 13 — 交付温升关联组合故障场景；17 — 交付 Mock AI 结构化诊断

**Status:** resolved

- [x] 系统分别计算诊断原因的命中、漏判和无证据推测，不把 Schema 通过视为诊断正确。
- [x] 六个内置场景均能形成可重复的诊断评估输入和结果，正常场景不会被强行赋予故障原因。
- [x] 仪表盘展示运行统计、近期失败、诊断状态和评估摘要，并能进入对应运行或诊断详情。
- [x] 诊断结论明确是 AI 辅助判断，不显示为检测结果、故障真值或根因证明。
- [x] API 主 seam 和关键 UI 流程覆盖评估计算、空数据、失败诊断和仪表盘导航。
- [x] 更新课程映射中的 AI 效果评估与仪表盘证据；工程日志记录真实评估问题；面试案例只使用实际运行产生的命中、漏判和推测数据。

## Answer

已交付 AI 效果评估与仪表盘闭环：诊断运行保存独立评估结果，按生成时的故障真值统计命中、漏判、无证据推测和误报；Schema 有效性与效果评估分开。六个内置场景通过固定种子生成可重复的诊断输入和评估结果，正常场景不分配故障类型。新增 `/api/dashboard` 和 `/api/runs/{id}/ai-evaluation`，前端可刷新运行、诊断和评估摘要并进入近期失败运行详情，页面明确 AI 是辅助判断，不是检测结果、故障真值或根因证明。

### 验证证据（2026-08-25）

- 阻塞依赖 Ticket 13、17 均为 `resolved`。
- `backend/tests/test_ai_evaluation_dashboard_api.py`：9 项通过，覆盖命中/漏判/推测、空数据、失败诊断、仪表盘导航契约和六场景重复性/期望命中。
- 后端完整 `backend\.venv\Scripts\python.exe -m pytest backend/tests -q`：98 项通过。
- 前端完整 `pnpm --dir frontend test`：24 项通过；`pnpm --dir frontend typecheck`、`pnpm --dir frontend format:check`、`pnpm --dir frontend build`、Ruff 全量检查和 `git diff --check` 通过。
- 前端测试和构建首次受 Windows 沙箱 `spawn EPERM` 影响，提升权限后通过；该失败属于环境权限错误，不是代码失败。
- 已知限制：原因对照使用面向合成场景的稳定别名匹配，不宣称通用自然语言评测或真实模型线上准确率；Ticket 20 首版一键验收未提前实现。
