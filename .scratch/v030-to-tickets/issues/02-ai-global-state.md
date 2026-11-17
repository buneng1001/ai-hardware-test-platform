# 02 — 全局 AI 状态持久化及开启准入

**Ticket ID:** V030-T02
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P0
**Spec items:** 01
**Spec chapters:** 01 §2、§5–6、§10–11
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T01
**Spec files:**
- `.scratch/ai-task-management/spec.md`

## What to build（目标与实施范围）

首页与顶栏共享后端持久化 AI enabled/disabled，开启需已保存且当前指纹验证有效。

## 预期涉及模块/文件（实施前再核对）

backend/app/database.py、ai_config.py、main.py；frontend/src/V020PrototypeShell.tsx、AI 配置入口

## 实施步骤和技术注意事项

增加最小后端状态接口与持久化；验证正式配置后才能开启；显示服务商/模型；无活动调用时允许直接关闭。

## 明确非目标

不按项目拆独立开关、不改变非 AI 测试链路。

## 可验证验收标准

- [ ] 未配置/未验证/旧验证均拒绝开启并解释
- [ ] 重启、刷新、换项目、多标签页显示同一状态
- [ ] AI 关闭时人工测试、规则转换、事实报告仍可用

## 自动化、集成与 UI 测试证据

持久化迁移、API 准入、双页面同步 UI 测试。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
