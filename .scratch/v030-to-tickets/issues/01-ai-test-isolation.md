# 01 — 连接测试与正式 AI 配置分离

**Ticket ID:** V030-T01
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P0
**Spec items:** 01
**Spec chapters:** 01 §5.2、§7.1–7.2
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** None — can start immediately
**Spec files:**
- `.scratch/ai-task-management/spec.md`

## What to build（目标与实施范围）

在任意 AI 运行状态下，可测试待测试模型，而不保存/切换正式配置与运行快照。

## 预期涉及模块/文件（实施前再核对）

backend/app/settings.py；backend/app/ai_config.py；frontend/src/V020PrototypeAiConfiguration.tsx、usePrototypeAiConfiguration.ts

## 实施步骤和技术注意事项

移除连接测试隐式 save_selection；将测试结果绑定待测试配置指纹；正式保存、验证失效和重新启用明确分开。

## 明确非目标

不保存临时密钥、不自动开启 AI、不建连接测试队列。

## 可验证验收标准

- [ ] 用 B 模型成功/失败验证不影响正式 A 模型及其活动调用
- [ ] 正式选择变更后旧验证失效，目录刷新不等于连接验证
- [ ] AI 关闭、业务调用占用时仍能独立连接测试

## 自动化、集成与 UI 测试证据

AI 配置 API Mock、并发测试和前端配置表单测试。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
