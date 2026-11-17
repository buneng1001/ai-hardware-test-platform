# 04 — 运行后诊断接入全局门控和局部取消

**Ticket ID:** V030-T04
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P0
**Spec items:** 01、02、03
**Spec chapters:** 01 §1.2、§3–4；02 §5.2；03 §4.3
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T03、V030-T11
**Spec files:**
- `.scratch/ai-task-management/spec.md`
- `.scratch/product-profile/spec.md`
- `.scratch/requirement-analysis-ui/spec.md`

## What to build（目标与实施范围）

既有诊断 AI 能在原页面被门控、查看状态和取消；已关联版本时读取冻结的通用上下文。

## 预期涉及模块/文件（实施前再核对）

后端运行后诊断路由/记录；frontend/src/diagnosisApi.ts、运行诊断 UI

## 实施步骤和技术注意事项

在诊断既有运行记录上登记活动调用；冻结正式配置、所需画像及有版本归属时的 ai_context；就地停止和迟到响应丢弃；刷新不重复发起。

## 明确非目标

不修改采集、确定性检查或原始诊断证据。

## 可验证验收标准

- [ ] 关闭或被其他调用占用时拒绝新的诊断
- [ ] 局部取消不关闭全局 AI，迟到结果不覆盖旧结果
- [ ] 无明确版本的调用不借用其他版本说明

## 自动化、集成与 UI 测试证据

既有诊断 API/组件回归、Mock 取消与运行快照验证。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
