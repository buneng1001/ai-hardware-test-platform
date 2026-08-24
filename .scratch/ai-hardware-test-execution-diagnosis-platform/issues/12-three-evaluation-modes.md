# 12 — 交付三种判定模式

**What to build:** 让测试工程师为运行选择正式规格、工程目标或版本基线，并在分析结果中获得符合各自语义、来源清楚且不受 AI 修改的判定。

**Blocked by:** 09 — 交付固定偏移时间对齐

**Status:** resolved

- [x] 新建任务支持需求验收、工程目标和摸底分析三种模式，并要求记录阈值来源。
- [x] 正式规格可产生合格或不合格结论；工程目标明确不代表产品承诺；版本基线只展示分布与趋势。
- [x] 判定优先级和阈值来源进入运行快照与分析结果，历史运行不受后续配置变化影响。
- [x] 系统不存在由 AI 创建、补充或修改阈值的路径。
- [x] API 主 seam 和关键 UI 流程覆盖三种模式及非法阈值输入。
- [x] 更新课程映射中的边界值和判定模式证据；工程日志记录真实语义或阈值问题；面试案例只补充已验证的三种判定能力。

## Answer

- 实现三种判定模式、三来源优先级、阈值来源快照和独立运行判定结果；摸底分析允许无阈值并固定返回 `not_applicable`，同时提供分布与趋势。
- 增加阈值白名单、非负数/整数边界、来源匹配和重复优先级校验；AI 诊断没有访问或修改判定配置的路径。
- 更新前端新建任务和运行详情，覆盖需求验收、工程目标、摸底分析及阈值来源展示。
- 验证证据：`backend\\.venv\\Scripts\\python.exe -m pytest backend/tests -q --disable-warnings` → 64 passed；Ticket 12 API 定向 9 项和 v7→v8 迁移测试通过；`backend\\.venv\\Scripts\\python.exe -m ruff check backend` → All checks passed；`pnpm --dir frontend test` → 5 files / 22 tests passed；`pnpm --dir frontend typecheck`、`pnpm --dir frontend format:check`、`pnpm --dir frontend build`、`git diff --check` 均通过。
- Code review：初审发现迁移重复列、摸底阈值语义、优先级未落地和 UI 覆盖缺口，已修复并补充回归测试；复审后的有效问题已全部处理。
- 已知限制：本 ticket 未实现 HTML/ZIP 报告导出、人工结果合并和 AI 诊断阈值治理；这些属于后续 ticket。
