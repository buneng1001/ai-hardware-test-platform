# 19 — 自动化回归建议来源资产、人工确认及技术校验

**Ticket ID:** V030-T19
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P1
**Spec items:** 08
**Spec chapters:** 08 §2.4；R08-10/13
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T18
**Spec files:**
- `.scratch/intelligent-regression-recommendations/spec.md`

## What to build（目标与实施范围）

自动化建议经用户明确应用后创建新来源记录和关联自动化资产；人工确认审计与技术校验独立。

## 预期涉及模块/文件（实施前再核对）

backend/app/source_test_cases.py、automation_test_cases.py、自动化模型/校验服务、回归应用 API

## 实施步骤和技术注意事项

逐条事务创建新来源+自动化，source_test_case_id 指向本次新来源且 test_type=回归测试；保存人工确认状态/时间/来源；运行既有确定性校验并呈现原因。

## 明确非目标

不指向相似旧用例、不用技术校验代替人工审核、不执行设备测试。

## 可验证验收标准

- [ ] 两项资产身份与来源 ID 正确；单条失败无孤儿记录
- [ ] 人工确认可追溯并与 validation_status 分开
- [ ] 技术校验失败不被冒充通过

## 自动化、集成与 UI 测试证据

R08-10/13；事务、成功/失败校验与来源关联测试。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
