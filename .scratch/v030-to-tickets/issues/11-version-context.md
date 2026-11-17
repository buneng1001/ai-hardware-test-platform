# 11 — 版本 ai_context 迁移、保存与界面

**Ticket ID:** V030-T11
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P0
**Spec items:** 03
**Spec chapters:** 03 §1–4.2、§5 R03-01～07/14/15
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** None — can start immediately
**Spec files:**
- `.scratch/requirement-analysis-ui/spec.md`

## What to build（目标与实施范围）

为每个产品版本新增独立的 AI 补充说明，测试需求页明确保存/撤销，按 3000 字符限制并隔离版本。

## 预期涉及模块/文件（实施前再核对）

backend/app/database.py、project_models.py、project_workspace.py；frontend/src/projectsApi.ts、V020RequirementsScreen.tsx

## 实施步骤和技术注意事项

迁移 product_versions.ai_context TEXT NOT NULL DEFAULT ''；扩展版本 GET/PATCH 与模型；UI 根据版本加载、保存、取消；与 description 完全分离；前后端相同字符计数，超限不截断。

## 明确非目标

不新建 AI 需求分析 API、不修改 version/name/description、不因保存自动调用模型。

## 可验证验收标准

- [ ] 旧版本迁移默认空；A/B 版本不串值，刷新恢复
- [ ] 空串和 3000 字符可保存，3001 拒绝且旧值不丢
- [ ] AI disabled 状态下也可保存、撤销，保存只改 ai_context

## 自动化、集成与 UI 测试证据

数据库升级、API 边界、版本隔离和页面失败草稿测试。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
