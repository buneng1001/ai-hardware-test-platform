# 13 — 最终报告来源的无选项、人工多选及历史对照

**Ticket ID:** V030-T13
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P1
**Spec items:** 08
**Spec chapters:** 08 §2.3；CONF-08-02/05/06/16
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** None — can start immediately
**Spec files:**
- `.scratch/intelligent-regression-recommendations/spec.md`

## What to build（目标与实施范围）

最终报告生成时自动化来源单选、人工批次多选，并可明确选择「无」及可选历史最终报告作为独立来源快照。

## 预期涉及模块/文件（实施前再核对）

backend/app/fact_report_models.py、fact_reports.py；frontend/src/useV020FactReports.ts、V020ReportPanel.tsx

## 实施步骤和技术注意事项

区分未初始化与明确无，禁止空值回退最新；扩展历史报告多选和有效 ID；保持每份历史报告版本/测试组/统计快照，不混算成主报告统计。

## 明确非目标

不自动纳入同组其他执行、不单独拿这些原始批次当智能回归输入。

## 可验证验收标准

- [ ] 明确无不会回退最新；人工无与具体批次互斥
- [ ] 历史报告保留真实 ID、版本和独立统计口径，不重复累计
- [ ] 至少存在符合报告契约的有效事实来源；不伪造空报告

## 自动化、集成与 UI 测试证据

报告创建 API、前端选择与历史统计 Mock/回归测试。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
