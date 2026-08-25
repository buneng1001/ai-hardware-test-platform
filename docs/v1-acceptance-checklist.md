# 首版验收清单

状态只写“已验证”或“未验证”。“已验证”必须能由命令或产物直接复查；远端 GitHub Actions 尚未运行时，不把 CI 远端状态写成已验证。

| 验收项 | 状态 | 直接证据 |
| --- | --- | --- |
| 六个内置场景可重复生成并检查 | 已验证 | `scripts/run_ticket20_acceptance.py`；`tmp/ticket20-acceptance/acceptance-summary.json`；`backend/tests/test_ai_evaluation_dashboard_api.py` |
| 三种数据模式和自定义边界 | 已验证 | `backend/tests/test_collection_tasks_api.py`；验收脚本 `modes` |
| 固定偏移和线性漂移对齐 | 已验证 | `backend/tests/test_fixed_offset_alignment_api.py`、`test_linear_drift_alignment_api.py`；验收脚本 `alignment` |
| 三种判定模式和阈值来源 | 已验证 | `backend/tests/test_evaluation_modes_api.py`；验收脚本 `modes` |
| 人工结果与自动检查独立汇总 | 已验证 | `backend/tests/test_manual_check_results_api.py`、`test_report_api.py`；验收脚本 `manual` |
| Mock 诊断、真值评估和仪表盘 | 已验证 | `backend/tests/test_mock_diagnosis_api.py`、`test_ai_evaluation_dashboard_api.py` |
| 模型不可用时运行和原始报告仍完成 | 已验证 | `backend/tests/test_siliconflow_contract.py`；验收脚本 `degradation` |
| HTML 报告和 ZIP 清单/哈希 | 已验证 | `backend/tests/test_report_api.py`；验收脚本 `normal-report.html`、`normal-evidence.zip` |
| 后端、前端、契约和公开 API 主 seam | 已验证 | `.github/workflows/ci.yml`；本地验证命令见 README |
| Allure 可查看结果 | 已验证 | 验收目录 `allure-results/ticket20-acceptance-result.json`；CI artifact `ticket20-allure-and-acceptance` |
| 仓库、日志、数据库、HTML、ZIP 安全扫描 | 已验证 | `scripts/check_repository_safety.py`、`scripts/check_artifact_safety.py` |
| 真实硅基流动线上调用效果 | 未验证 | 本地与 CI 均不使用真实 Key，只有适配器契约和 Mock 证据 |
| 远端 GitHub Actions 实际运行记录 | 未验证 | 本地已配置 workflow，需推送后查看 Actions artifact |

## 复查顺序

```powershell
backend/.venv/Scripts/python.exe scripts/run_ticket20_acceptance.py
backend/.venv/Scripts/python.exe scripts/check_artifact_safety.py tmp/ticket20-acceptance
backend/.venv/Scripts/python.exe -m pytest backend/tests -q
pnpm test -- --run
pnpm typecheck
```
