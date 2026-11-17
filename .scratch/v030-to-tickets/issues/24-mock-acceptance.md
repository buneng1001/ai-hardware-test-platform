# 24 — 完整 Mock、迁移和 V0.2.0 回归保护验收

**Ticket ID:** V030-T24
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P0
**Spec items:** 01–08、10、11（09 保护）
**Spec chapters:** 最终审计 §2–3、§6；各详细 Spec 验收矩阵
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** V030-T07、V030-T08、V030-T09、V030-T10、V030-T12、V030-T16、V030-T21、V030-T23
**Spec files:**
- `docs/plans/v0.3.0-to-spec-final-audit.md`
- `docs/plans/v0.3.0-ai-risk-and-cases.md`
- `.scratch/ai-task-management/spec.md`
- `.scratch/product-profile/spec.md`
- `.scratch/requirement-analysis-ui/spec.md`
- `.scratch/ai-risk-review-placeholder/spec.md`
- `.scratch/intelligent-case-recommendation-placeholder/spec.md`
- `.scratch/recommended-case-review-placeholder/spec.md`
- `.scratch/ai-recommendation-publish-placeholder/spec.md`
- `.scratch/intelligent-regression-recommendations/spec.md`
- `.scratch/source-automation-case-linkage/spec.md`
- `.scratch/requirement-import-placeholder/spec.md`
- `docs/plans/v0.3.0-open-decisions.md`（09 取消、DEC-08-30）

## What to build（目标与实施范围）

用固定夹具把 V0.3.0 规格与已实现行为逐项对照，并保留独立自动化/UI/故障证据；不把设计称为测试通过。

## 预期涉及模块/文件（实施前再核对）

backend/tests/、frontend/src/*.test.tsx、现有 CI/安全检查脚本与验收记录

## 实施步骤和技术注意事项

覆盖 A01–A30、P01–P16、R03-01～15、R08-01～20、R10-01～12、R04～07/I11；核验 DB 迁移/报告/用例及组关系；回归旧人工结果附件上传、查看下载及历史证据能力。

## 明确非目标

不实现 09 附件继承、不用 Mock 替代真实模型、不新增需求分析业务。

## 可验证验收标准

- [ ] 所有矩阵项有运行结果或明确阻塞，不能预填已通过
- [ ] CSV/XLSX、人工测试、规则转换、事实报告、自动化转换、测试组与原附件可用
- [ ] 迁移、取消、并发、幂等、失败保留旧结果可复现

## 自动化、集成与 UI 测试证据

真实运行 Pytest、前端测试/类型检查/构建、安全扫描；按结果记录 PASS/FAIL/SKIP。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
