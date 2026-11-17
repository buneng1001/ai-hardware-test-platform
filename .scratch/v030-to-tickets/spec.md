# V0.3.0 To Tickets｜正式规格索引（非新业务 Spec）

**基线：** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**状态：** To Tickets 已获用户确认；尚未实施。

所有 Ticket 均以已结项的详细 Spec 为准；本索引仅用于沿用既有 .scratch 本地 Issue 机制。

- 10：`.scratch/source-automation-case-linkage/spec.md`
- 11：`.scratch/requirement-import-placeholder/spec.md`
- 01：`.scratch/ai-task-management/spec.md`
- 02：`.scratch/product-profile/spec.md`
- 03：`.scratch/requirement-analysis-ui/spec.md`
- 04：`.scratch/ai-risk-review-placeholder/spec.md`
- 05：`.scratch/intelligent-case-recommendation-placeholder/spec.md`
- 06：`.scratch/recommended-case-review-placeholder/spec.md`
- 07：`.scratch/ai-recommendation-publish-placeholder/spec.md`
- 08：`.scratch/intelligent-regression-recommendations/spec.md`

总体审计：`docs/plans/v0.3.0-to-spec-final-audit.md`；决策记录：`docs/plans/v0.3.0-open-decisions.md`；总规格：`docs/plans/v0.3.0-ai-risk-and-cases.md`。

- 09 已取消，不生成新增开发 Ticket；T24 只保护既有人工测试结果证据附件。
- 04/05/11 仅 UI 占位；06/07 不显示审核/发布入口，也不得创建伪造业务结果。
- DEC-08-30：08 相同输入重试无覆盖复选框，完整成功且保存后才替换唯一当前建议。
- 已确认 25 项 Ticket 的开发拆分及 G01–G07 人工验收关口；Issue 状态为 ready-for-agent，实施仍须逐项独立分支和技术验收。
