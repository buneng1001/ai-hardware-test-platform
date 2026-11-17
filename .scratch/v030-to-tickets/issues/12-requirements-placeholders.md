# 12 — 测试需求占位区及审核发布入口缺席保护

**Ticket ID:** V030-T12
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P0
**Spec items:** 03、04、05、06、07、11
**Spec chapters:** 03 §3.2–3.3；04 §2–5；05 §2–6；06 §1–6；07 §1–7；11 §2–7
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T11
**Spec files:**
- `.scratch/requirement-analysis-ui/spec.md`
- `.scratch/ai-risk-review-placeholder/spec.md`
- `.scratch/intelligent-case-recommendation-placeholder/spec.md`
- `.scratch/recommended-case-review-placeholder/spec.md`
- `.scratch/ai-recommendation-publish-placeholder/spec.md`
- `.scratch/requirement-import-placeholder/spec.md`

## What to build（目标与实施范围）

材料操作区只保留开发中提示按钮，另一区域真实保存版本说明；06/07 没有虚假审核发布入口，现有功能不删。

## 预期涉及模块/文件（实施前再核对）

frontend/src/V020RequirementsScreen.tsx、V020PrototypeCases.tsx、V020SourceCasesScreen.tsx 及组件测试

## 实施步骤和技术注意事项

移除原需求文件选择器、文件名回显、AI解析勾选及常驻未开发文案；导入需求点、AI 分析、智能测试用例推荐均为可点击轻量提示；按 04 Spec 在现有工作区落实未来风险分析/审核的可见占位入口或必要页面外壳，若有操作仅提示「该功能开发中」，明确不改动既有事实报告「AI 风险提示」；06/07 审核与发布入口完全不出现。

## 明确非目标

不发模型/API、不建需求风险推荐及审核发布数据，不影响正式用例导入和原自动化转换。

## 可验证验收标准

- [ ] 各占位按钮在 AI 开关任意状态下仅提示「该功能开发中」且不打开文件框或发请求
- [ ] 04 未来风险分析/审核占位可见且无真实风险数据，点击只提示开发中；既有报告 AI 风险提示不受影响
- [ ] 06/07 没有菜单、按钮、审核/发布页面或模拟结果
- [ ] 现有 CSV/XLSX、规则转换、AI 自动化转换、测试组及报告风险提示保持

## 自动化、集成与 UI 测试证据

R03-11～13、R04、R05、R06、R07、I11 UI/网络无副作用测试。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
