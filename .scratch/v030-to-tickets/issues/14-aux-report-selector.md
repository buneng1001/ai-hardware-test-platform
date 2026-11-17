# 14 — 智能回归辅助报告标签选择与校验

**Ticket ID:** V030-T14
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P1
**Spec items:** 08
**Spec chapters:** 08 §2.2、§5；R08-02～06
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T13
**Spec files:**
- `.scratch/intelligent-regression-recommendations/spec.md`

## What to build（目标与实施范围）

当前最终报告自动为主报告；按标签选同项目其他版本最终报告，支持搜索、筛选、移除及合法性校验。

## 预期涉及模块/文件（实施前再核对）

后端最终报告候选/校验查询；frontend/src/V020ReportPanel.tsx、factReportsApi.ts、回归选择组件

## 实施步骤和技术注意事项

候选倒序并展示版本、组、编号、时间、AI 状态；排除主报告和主报告已嵌入报告 ID；服务端拒绝重复/跨项目/失效 ID；对失效选择明确移除或取消。

## 明确非目标

不自动添加最近报告，不选择单独人工/自动化运行记录，不要求辅助报告 AI 分析成功。

## 可验证验收标准

- [ ] 无辅助报告仍可生成；两种无候选状态各自提示且不清标签
- [ ] 关键词、版本筛选可叠加，已选项不重复显示
- [ ] 绕过前端提交跨项目/嵌入/重复/损坏 ID 会被服务端拒绝

## 自动化、集成与 UI 测试证据

R08-02～06 固定 Mock、权限校验、标签筛选组件测试。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
