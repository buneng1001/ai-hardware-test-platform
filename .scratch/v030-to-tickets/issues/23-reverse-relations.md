# 23 — 自动化表与测试组来源反向链接和安全降级

**Ticket ID:** V030-T23
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P1
**Spec items:** 10
**Spec chapters:** 10 §4–6；R10-06～12
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T22
**Spec files:**
- `.scratch/source-automation-case-linkage/spec.md`

## What to build（目标与实施范围）

从自动化表及测试组自动化列表基于真实来源 ID 定位原始用例；无效/无权限时不泄露或错误跳转。

## 预期涉及模块/文件（实施前再核对）

backend/app/automation_test_cases.py；frontend/src/V020AutomationCaseTable.tsx、V020TestGroupAutomationCases.tsx、TestGroupAutomationScope.tsx

## 实施步骤和技术注意事项

保留自动化表来源链接；在组现有信息区加来源入口而非第十列；按项目/版本/ID 导航，对 404、无权、缓存失效/超时做中性提示。

## 明确非目标

不建新来源页面、不改现有九列、资产身份和校验状态。

## 可验证验收标准

- [ ] 两处来源链接定位正确 ID，同标题跨版本不串线
- [ ] 来源不可用禁止误跳并且不泄露
- [ ] 九列表格及所有既有操作不减、只读展示无业务写入

## 自动化、集成与 UI 测试证据

R10-06～12，Stub 异常、13 寸/4K 截图及数据库前后对照。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
