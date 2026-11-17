# 18 — 人工回归建议写入指定版本用例表

**Ticket ID:** V030-T18
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P1
**Spec items:** 08
**Spec chapters:** 08 §2.4；R08-10/12
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T17
**Spec files:**
- `.scratch/intelligent-regression-recommendations/spec.md`

## What to build（目标与实施范围）

用户明确选择目标版本，只把已勾选的人工建议新增为正式来源用例，并记录建议来源。

## 预期涉及模块/文件（实施前再核对）

backend/app/source_test_cases.py、project_workspace.py、回归应用 API；前端应用弹窗

## 实施步骤和技术注意事项

预检目标版本、项目归属；逐条创建新独立来源用例，test_type=回归测试，绑定报告/建议来源追溯与已应用映射；成功项不可二次应用。

## 明确非目标

不默认用报告版本、不覆盖/合并相似旧用例，不指向旧用例 ID。

## 可验证验收标准

- [ ] 只处理选中建议且必须选目标版本
- [ ] 内容相同仍创建新记录，旧用例和事实无变化
- [ ] 同建议重复应用不重复创建，失败不冒充已加入

## 自动化、集成与 UI 测试证据

R08-10/12；人工来源创建/幂等/版本隔离 API 与原 CSV 导入回归。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
