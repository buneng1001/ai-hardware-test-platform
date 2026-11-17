# 03 — 唯一 AI 活动调用原子锁与取消生命周期

**Ticket ID:** V030-T03
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P0
**Spec items:** 01
**Spec chapters:** 01 §2–4、§9–10
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T02
**Spec files:**
- `.scratch/ai-task-management/spec.md`

## What to build（目标与实施范围）

跨项目只准同时一项 AI 业务活动；提供最小活动摘要与就地取消钩子，停止收尾前仍占用。

## 预期涉及模块/文件（实施前再核对）

backend/app/ai_config.py、database.py、main.py、AI 运行适配层；活动状态 API

## 实施步骤和技术注意事项

实现原子准入、运行标识、活动摘要和取消意图；迟到模型响应不得写结果；本地请求返回或超时且清理完才释放；重启未完成记录标记 interrupted。

## 明确非目标

不增加 queued、FIFO、worker、集中任务列表，不保证远端停止计费。

## 可验证验收标准

- [ ] 并发请求仅一项占锁，第二项收到占用提示
- [ ] 正在停止时仍占锁并拒绝正式配置切换
- [ ] 中断后不自动继续；日志/摘要不含密钥和完整 Prompt

## 自动化、集成与 UI 测试证据

并发、迟到响应、底层请求不可中断和 crash 恢复故障注入。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
