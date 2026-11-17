# 05 — 最终报告 AI 总体分析门控和安全快照

**Ticket ID:** V030-T05
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P0
**Spec items:** 01、02、03
**Spec chapters:** 01 §3–4；03 §4.3；08 §3–4
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T03、V030-T11
**Spec files:**
- `.scratch/ai-task-management/spec.md`
- `.scratch/product-profile/spec.md`
- `.scratch/requirement-analysis-ui/spec.md`

## What to build（目标与实施范围）

既有事实报告 AI 分析遵守全局占用、取消与运行输入快照，事实报告本身仍独立生成。

## 预期涉及模块/文件（实施前再核对）

backend/app/fact_reports.py、报告 AI 分析模块；frontend/src/V020ReportAnalysisSection.tsx、useV020FactReports.ts

## 实施步骤和技术注意事项

挂接现有 AI 分析批次与检查点；冻结版本说明、所需画像、正式模型和事实快照；分阶段检查取消，保留有效检查点；让 08 可查到成功的总体分析状态。

## 明确非目标

不改写原报告统计、历史事实或未来 04 风险审核记录。

## 可验证验收标准

- [ ] AI 关闭不阻止生成事实报告，仅门控 AI 总体分析
- [ ] 取消不提交半结果或覆盖原结果
- [ ] 运行期间画像/ai_context 修改不改变当前批次及历史报告事实

## 自动化、集成与 UI 测试证据

报告生命周期、取消/检查点、不同版本上下文 API Mock。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
