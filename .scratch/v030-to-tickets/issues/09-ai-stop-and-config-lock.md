# 09 — 全局关闭与正式配置运行锁的双选项交互

**Ticket ID:** V030-T09
**Status:** implemented-awaiting-user-acceptance（独立分支实现及自动化回归完成，待人工验收）
**Priority:** P0
**Spec items:** 01
**Spec chapters:** 01 §5.3–7.2、§10–12
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T03、V030-T04、V030-T05、V030-T06
**Spec files:**
- `.scratch/ai-task-management/spec.md`

## What to build（目标与实施范围）

顶栏关闭或保存正式配置冲突时显示当前活动调用，只能选择停止当前 AI 或取消操作。

## 预期涉及模块/文件（实施前再核对）

backend/app/ai_config.py、正式配置保存/API；frontend/src/V020PrototypeShell.tsx、V020PrototypeAiConfiguration.tsx

## 实施步骤和技术注意事项

活动调用时禁止立即保存配置；弹窗显示调用名与所属项目；停止后完整收尾再关闭 AI；配置保存需用户再次主动点击；允许待测试配置编辑/连接测试。

## 明确非目标

不自动等待关闭/保存、不新增第三个选项或集中任务中心。

## 可验证验收标准

- [ ] 取消关闭后 AI 和原调用保持，且不自动再次弹窗
- [ ] 停止完成前不能提前显示 disabled 或解锁配置
- [ ] 正式配置保存后旧验证失效并需用户手动开启

## 自动化、集成与 UI 测试证据

并发配置修改、取消收尾、弹窗 UI 和刷新状态集成测试。

## Definition of Done

- [x] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [x] 实施与上述验收条件一致；后端真实 SQLite/API、前端交互测试已执行。
- [x] V0.2.0 全量自动化回归：后端 260 passed；前端 188 passed、3 skipped；T9 新增前端交互测试 6 passed。未接触敏感配置、用户输入或报告证据。
- [x] 已审查改动、确认 `git diff --check` 通过；全量测试未发现失败。待人工验收后再结项。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
- 2026-11-23：T9 已在 `feat/v030-t09-ai-stop-and-config-lock` 实施完成。后端 schema v42 新增停止后关闭标记；`stop-and-disable` 仅请求取消并设置意图，原调用完成收尾时在同一 SQLite 写事务内关闭 AI，期间持续保留活动锁；重启恢复也会完成已确认的关闭意图。前端顶栏及配置保存冲突均提供双选项弹窗，停止后等待活动调用消失，配置保存必须用户再次主动点击。全量后端测试 260 passed；全量前端测试 188 passed / 3 skipped；T9 定向前端测试 6 passed。当前未提交、未推送、未创建 PR，等待人工验收。
