# 09 — 全局关闭与正式配置运行锁的双选项交互

**Ticket ID:** V030-T09
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
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

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
