# 14 — 录入和导入人工检查结果

**What to build:** 让测试工程师为运行记录录入或批量导入人工检查结果，并与检测结果独立保存、统一查看。

**Blocked by:** 03 — 生成正常场景文件并跑通首个运行记录

**Status:** resolved

- [x] 测试工程师可新增人工检查项并记录通过、失败、阻塞或未执行状态。
- [x] 人工检查结果支持实际结果、备注、执行时间和受限的小型附件。
- [x] 统一 CSV 和 Excel 模板可导入有效数据，对无效行提供可定位的错误且不产生部分静默失败。
- [x] 人工检查结果与检测结果独立持久化，在运行分析视图中统一汇总但不互相覆盖。
- [x] API 主 seam 和关键 UI 流程覆盖新增、修改、导入和错误处理。
- [x] 更新课程映射中的 CSV/Excel 数据驱动和人工结果证据；工程日志记录真实导入问题；面试案例只补充已验证的人工检查能力。

## Answer

已通过公开 API seam 和关键 UI 流程实现人工检查结果新增、修改、独立持久化与运行分析汇总。四种人工状态、
实际结果、备注、执行时间及最大 1 MiB 的 TXT/PNG/JPEG/PDF 附件均可记录，附件通过受运行记录和结果 ID
约束的下载接口复核。CSV/XLSX 共用统一五列表头、行级错误和单事务写入，无效批次不会部分静默成功。

### 验证证据（2026-08-22）

- `backend/.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider --basetemp <项目内目录>`：33 passed。
- `backend/.venv/Scripts/python.exe -m ruff check app tests`：All checks passed。
- `backend/.venv/Scripts/python.exe -m ruff format --check app tests`：14 files already formatted。
- `pnpm --dir frontend test`：3 个测试文件、10 项测试通过。
- `pnpm --dir frontend typecheck`：通过，无 TypeScript 错误。
- `pnpm --dir frontend build`：Vite 生产构建成功，20 modules transformed。
- `prettier --check frontend/src`：所有文件符合 Prettier 格式。
- `backend/.venv/Scripts/python.exe scripts/check_repository_safety.py`：安全扫描通过。
- `git diff --check`：通过，无空白错误。
- `$code-review` 以 `origin/main...HEAD` 完成 Standards/Spec 双轴复审：Standards 0 个硬违规；Spec 无发现。

审查修复包括：拆分超过文件规模预警的后端导入模块和前端结果列表、补齐附件下载公开 seam、在运行分析
子视图完整展示人工证据，并修复切换运行记录时的面板状态重置。保留两个轻度判断项：后端单条/批量插入
存在少量字段重复；人工结果面板仍内聚处理表单、附件和导入，当前均未构成规则违规。

已知限制：导入文件最大 2 MiB，XLSX 只读取活动工作表；独立交互报告和 HTML 报告属于 Ticket 15，未提前实现。
