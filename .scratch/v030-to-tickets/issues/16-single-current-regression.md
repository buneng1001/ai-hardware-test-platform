# 16 — 唯一当前智能回归建议持久化及 DEC-08-30

**Ticket ID:** V030-T16
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P1
**Spec items:** 08、01
**Spec chapters:** 08 §2.5、§5–6；01 §8.1–8.2；DEC-08-30
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T15
**Spec files:**
- `.scratch/intelligent-regression-recommendations/spec.md`
- `.scratch/ai-task-management/spec.md`

## What to build（目标与实施范围）

项目仅有一份可恢复显示的当前智能回归建议，新结果完整校验并保存成功才替换，异常保留旧建议与正式资产。

## 预期涉及模块/文件（实施前再核对）

backend/app/database.py、回归建议持久化/API；前端重复执行确认和读取 UI

## 实施步骤和技术注意事项

保存项目与主辅报告、事实摘要、版本上下文指纹、invocation 和逐条候选；成功事务内切换当前建议；同条件重试仅重新执行/取消，无覆盖复选框；运行中先取消收尾。

## 明确非目标

不建立历史建议恢复库、不删除已应用正式用例或原报告事实。

## 可验证验收标准

- [ ] 刷新可取唯一当前建议；新建议成功替换并重置旧选择
- [ ] 失败、取消、超时、校验或保存失败均保留旧建议
- [ ] 同输入重试和运行中重复均不出现覆盖勾选，不并发

## 自动化、集成与 UI 测试证据

R08-16/17/20 与 A30；事务与迟到结果故障测试。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
