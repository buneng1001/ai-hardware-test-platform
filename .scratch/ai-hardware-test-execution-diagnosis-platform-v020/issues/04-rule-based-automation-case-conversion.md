# 04 — 通过规则服务生成自动化用例候选

**What to build:** 从原始测试用例生成独立、可编辑的自动化用例候选。业务通过 `AutomationCaseConversionService` 调用确定性规则实现；无模型、无 Skill 和无外网时，该流程仍能完整运行。

**Blocked by:** 03 — 导入并管理原始测试用例。

**Status:** ready-for-agent

**当前前端 Demo 对应页面：** “自动化用例表”和“生成自动化用例”。

- [x] 转换不会修改或覆盖原始测试用例。
- [x] 每条自动化用例获得系统生成、不可编辑且不复用的唯一编号。
- [x] 自动化用例只保留一个可点击的来源用例编号，可返回对应原始用例。
- [x] 规则实现输出统一结构的候选内容、低可信度状态和人工审核提示。
- [x] 单行缺少必要信息或转换失败不会使整批失败，失败行具有明显视觉状态和简短原因。
- [x] 服务边界允许未来替换实现，但 v0.2.0 不依赖具体 Skill、Skill 文件格式或供应商 SDK。
- [x] 数据库、转换接口、自动化用例表、规则样例和无 AI 环境均有自动化测试。

## 2026-10-28 状态校准

- 已有：不覆盖源用例的规则转换、唯一自动化编号、来源关系、低可信度候选、逐行失败隔离、幂等行为和后端测试。
- 未完成：冻结版自动化用例表尚未调用真实转换接口，也未用真实失败行和来源跳转完成入口级验收。
- 结论：后端规则实现已完成，冻结 UI 联调待完成。

## 2026-10-29 完成记录

- 冻结版“自动化用例表”改为读取 `/api/product-versions/{id}/automation-test-cases`：展示真实规则候选、系统生成的唯一编号、单一可点击来源用例和低可信度人工审核提示；转换失败行使用独立背景色和简短原因。加载、空、失败与重试状态独立展示。
- “测试用例表”和“自动化用例表”均可触发 `/automation-test-case-conversions/rules`；生成成功切到自动化用例表，没有新来源时提示不会覆盖已有候选。点击来源编号可回到原始用例表并高亮对应行。
- 后端补充 `AutomationCaseConversionService` 注入替换实现测试，证明业务只依赖转换接口，不依赖具体规则、Skill 文件格式或供应商 SDK。
- 证据：`frontend/src/V020AutomationCases.test.tsx`（5 项）、`frontend/src/V020AutomationCaseTable.tsx`、`backend/tests/test_automation_case_conversion_service.py`，以及既有 `backend/tests/test_automation_case_conversion_api.py`（3 项）；后端 168 通过，前端 93 通过 / 3 跳过，`tsc -b`、`vite build`、Prettier、Ruff 与仓库安全检查均通过。
- 剩余：自动化用例的编辑、批量 AI 反馈、校验和转换历史由 05 接入；页头“可自动化/人工验证”数字仍为样例值；自动化用例选择与加入测试组由 07 接入。
