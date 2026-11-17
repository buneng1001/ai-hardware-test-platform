# 22 — 来源用例自动化 ×N 全量关联与类型筛选

**Ticket ID:** V030-T22
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P1
**Spec items:** 10
**Spec chapters:** 10 §2–5；R10-01～05/08
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** None — can start immediately
**Spec files:**
- `.scratch/source-automation-case-linkage/spec.md`

## What to build（目标与实施范围）

来源用例仍为独立人工资产，显示有效自动化副本全量数量和明细，类型筛选只按有无副本解释。

## 预期涉及模块/文件（实施前再核对）

backend/app/source_test_cases.py、source_test_case_models.py；frontend/src/V020SourceCaseTable.tsx、SourceTestCasesPanel.tsx

## 实施步骤和技术注意事项

依现有 v18 一对多关系做全量计数及列表而非当前页/首条；行内 ×N 查看全部；类型、测试类型保持独立；加载失败与重试。

## 明确非目标

不恢复 source_test_case_id 唯一约束，不把自动化资产行混入原始表。

## 可验证验收标准

- [ ] 0/1/3 副本数量准确，分页外副本仍计入
- [ ] 人工筛零副本、自动化筛至少一副本，测试类型另筛
- [ ] 未知时不显示虚假 0，失败提示重试，读取不写数据

## 自动化、集成与 UI 测试证据

R10-01～05/08；固定 S-0/S-1/S-3 Mock 和分页/异常测试。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
