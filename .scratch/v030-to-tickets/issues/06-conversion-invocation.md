# 06 — AI 自动化转换批次受控及结果隔离

**Ticket ID:** V030-T06
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P0
**Spec items:** 01、02、03
**Spec chapters:** 01 §1.2、§3–4、§9；02 §5.2；03 §4.3
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T03、V030-T11
**Spec files:**
- `.scratch/ai-task-management/spec.md`
- `.scratch/product-profile/spec.md`
- `.scratch/requirement-analysis-ui/spec.md`

## What to build（目标与实施范围）

保留已有 AI 自动化转换和无 AI 规则转换，AI 转换受全局锁和就地取消，后续批次使用冻结输入。

## 预期涉及模块/文件（实施前再核对）

backend/app/automation_conversion_ai.py、automation_conversion.py；frontend/src/V020AiGenerateDialog.tsx、自动化用例 hooks

## 实施步骤和技术注意事项

启动时固定来源用例、配置、画像及版本 ai_context；安全点检查取消，禁止新的批次与迟到结果写入，保留已保存的有效检查点。

## 明确非目标

不把 AI 转换改造成未来的需求→用例推荐，不阻断规则转换。

## 可验证验收标准

- [ ] AI 关闭阻止模型转换但规则转换仍正常
- [ ] 取消后不启动后续批次，已有有效结果保留
- [ ] 说明或画像更新后不错误续接旧检查点

## 自动化、集成与 UI 测试证据

AI 转换与规则转换回归、跨项目占用和批次取消 Mock。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
