# 25 — 真实模型双路径与 4K/13 寸最终验收

**Ticket ID:** V030-T25
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P1
**Spec items:** 01、02、03、08、10
**Spec chapters:** 08 §6.3–6.4；10 §6；最终审计 §3
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T24
**Spec files:**
- `.scratch/ai-task-management/spec.md`
- `.scratch/product-profile/spec.md`
- `.scratch/requirement-analysis-ui/spec.md`
- `.scratch/intelligent-regression-recommendations/spec.md`
- `.scratch/source-automation-case-linkage/spec.md`

## What to build（目标与实施范围）

分别验证真实模型仅主报告和带有效辅助报告的回归分析质量，在两种设备规格上核对全部操作并记录正式证据。

## 预期涉及模块/文件（实施前再核对）

既有前后端启动方法、人工验收文档/脱敏报告及两设备 UI

## 实施步骤和技术注意事项

使用已保存且验证有效的真实配置与脱敏报告分别跑两种生成路径；人工核对来源证据、四段分析、可执行步骤、技术校验及正式应用；检查 27 寸 4K 和 13 寸所有表格列、布局/控件。

## 明确非目标

不要求真实模型固定标题或数量、不把 HTTP 200 当质量通过、不做新业务开发。

## 可验证验收标准

- [ ] 真实模型两条路径各自记录模型、时间、报告、脱敏输出和人工结论
- [ ] 双设备所有按钮/表格列/测试组九列完整，无遮挡挤压
- [ ] 任何失败或未执行项仍记录为阻塞，不宣称版本已验收

## 自动化、集成与 UI 测试证据

真实模型日志/截图与 Mock 分卷留证；人工最终签收。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
