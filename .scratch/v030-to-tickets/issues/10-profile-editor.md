# 10 — 项目画像编辑与接口预设快捷输入

**Ticket ID:** V030-T10
**Status:** ready-for-agent（To Tickets 已确认，待逐项实施）
**Priority:** P0
**Spec items:** 02
**Spec chapters:** 02 §1–5、§6 P01–P16
**Baseline:** `main@49c4666d1216fb82a6d34cf85e7bd9f76f237a53`
**Blocked by:** None — can start immediately
**Spec files:**
- `.scratch/product-profile/spec.md`

## What to build（目标与实施范围）

在已有项目卡片更多菜单中编辑项目级画像，复用现有字段/API 并提供可自由修改的接口快捷标签。

## 预期涉及模块/文件（实施前再核对）

backend/app/project_models.py、project_workspace.py；frontend/src/V020ProjectsScreen.tsx、projectsApi.ts

## 实施步骤和技术注意事项

新增编辑弹窗、草稿保存/取消；接口预设按四组标签追加并去重，前端限制对齐 300 字符；运行中编辑只提示下一次相关 AI 运行生效。

## 明确非目标

不扩展字段、不新增版本画像、不强迫用户只能选预设。

## 可验证验收标准

- [ ] 保存后列表、详情和刷新均显示最新画像，取消或失败不写入
- [ ] null 历史画像未保存不自动入库；0–999 数量与平台字段校验保留
- [ ] 快捷标签追加保留自由文本、允许删除、300 字符上限；历史报告不回写

## 自动化、集成与 UI 测试证据

项目 API、画像编辑 UI、运行中修改、P01–P16 测试。

## Definition of Done

- [ ] 依赖项已完成并重新核实实际代码落点，未擅自扩展 Spec 边界。
- [ ] 实施与上述验收条件逐项一致，自动化/集成/UI 测试真实执行并留存可复查结果。
- [ ] 既有 V0.2.0 功能回归确认，敏感配置、输入和报告证据不被泄露。
- [ ] 完成改动审查、失败与限制记录；未执行项目绝不声明通过。

## Comments

- 2026-11-17：To Tickets 已确认，尚未进入 Implement；按独立 Issue 分支开发并接受 G01–G07 阶段验收。
