"""v0.2.0 固定样例黄金路径：迁移后的公开 API 逐层验收。"""

import base64
import time

from fastapi.testclient import TestClient

from app.case_services import RequirementPointAnalysisService, TestCaseGenerationService
from app.main import app


def _wait_for_completed_run(client: TestClient, run_id: int) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return
        assert run["status"] not in {"failed", "cancelled", "interrupted"}
        time.sleep(0.01)
    raise AssertionError(f"固定样例数据任务 #{run_id} 未在 10 秒内完成")


def _create_data_package(client: TestClient, scenario: str) -> int:
    task = client.post(
        "/api/collection-tasks",
        json={"name": f"固定样例-{scenario}", "mode": "quick", "scenario": scenario},
    )
    assert task.status_code == 201, task.text
    run = client.post(f"/api/collection-tasks/{task.json()['id']}/runs")
    assert run.status_code == 201, run.text
    _wait_for_completed_run(client, run.json()["id"])
    kind = "normal" if scenario == "normal" else "fault"
    packages = client.get("/api/data-packages", params={"data_kind": kind})
    assert packages.status_code == 200, packages.text
    return packages.json()["items"][0]["id"]


def test_v020_fixed_sample_covers_migrations_api_fallbacks_reports_and_trends(tmp_path, monkeypatch):
    """固定项目与合成样例覆盖 v0.2.0 交付链路，不访问设备或模型服务。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("REPORT_ANALYSIS_MODE", raising=False)

    with TestClient(app) as client:
        # 数据包入口：正常样例应通过，已知故障样例应在自动化执行中失败。
        normal_package_id = _create_data_package(client, "normal")
        fault_package_id = _create_data_package(client, "video_drop")

        project = client.post(
            "/api/projects",
            json={"name": "固定验收项目", "product_name": "合成记录仪", "description": "v0.2.0 CI 样例"},
        )
        assert project.status_code == 201, project.text
        version = client.post(f"/api/projects/{project.json()['id']}/product-versions", json={"version": "EVT1"})
        assert version.status_code == 201, version.text
        version_id = version.json()["id"]

        imported = client.post(
            f"/api/product-versions/{version_id}/source-test-case-imports",
            json={
                "source_filename": "fixed-sample.csv",
                "field_mapping": {
                    "case_number": "编号",
                    "title": "标题",
                    "test_type": "类型",
                    "module": "模块",
                },
                "rows": [
                    {"编号": "SRC-NORMAL", "标题": "录制", "类型": "automation", "模块": "采集"},
                    {"编号": "SRC-FAULT", "标题": "录制", "类型": "automation", "模块": "采集"},
                    {"编号": "SRC-MANUAL", "标题": "人工外观检查", "类型": "manual", "模块": "外观"},
                    {"编号": "SRC-PENDING", "标题": "待执行人工检查", "类型": "manual", "模块": "外观"},
                ],
            },
        )
        assert imported.status_code == 201, imported.text
        source_cases = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
        source_ids = {item["case_number"]: item["id"] for item in source_cases}

        # 需求点分析和测试用例生成是显式关闭实现，导入和规则转换不依赖它们。
        assert RequirementPointAnalysisService().analyze({"title": "固定样例"})["status"] == "disabled"
        assert TestCaseGenerationService().generate({"requirement_id": "FIXED-1"})["status"] == "disabled"
        conversion = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules")
        assert conversion.status_code == 201, conversion.text
        validation = client.post(f"/api/product-versions/{version_id}/automation-test-cases/validate")
        assert validation.status_code == 200 and validation.json()["valid"], validation.text
        automation_cases = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]
        automation_ids = {item["source_case_number"]: item["id"] for item in automation_cases}

        group = client.post(f"/api/product-versions/{version_id}/test-groups", json={"name": "固定回归组"})
        assert group.status_code == 201, group.text
        group_id = group.json()["id"]
        assert (
            client.post(
                f"/api/test-groups/{group_id}/automation-test-cases",
                json={"case_ids": [automation_ids["SRC-NORMAL"], automation_ids["SRC-FAULT"]]},
            ).status_code
            == 200
        )
        assert (
            client.put(
                f"/api/test-groups/{group_id}/automation-test-cases/{automation_ids['SRC-NORMAL']}/data-packages",
                json={"data_package_ids": [normal_package_id]},
            ).status_code
            == 200
        )
        assert (
            client.put(
                f"/api/test-groups/{group_id}/automation-test-cases/{automation_ids['SRC-FAULT']}/data-packages",
                json={"data_package_ids": [fault_package_id]},
            ).status_code
            == 200
        )
        assert (
            client.post(
                f"/api/test-groups/{group_id}/source-test-cases",
                json={"case_ids": [source_ids["SRC-MANUAL"], source_ids["SRC-PENDING"]]},
            ).status_code
            == 200
        )

        preparation = client.post(f"/api/test-groups/{group_id}/automation-execution-preparations")
        assert preparation.status_code == 200 and preparation.json()["passed"], preparation.text
        execution = client.post(f"/api/test-groups/{group_id}/automation-executions")
        assert execution.status_code == 201, execution.text
        assert execution.json()["summary"] == {"passed": 1, "failed": 1, "blocked": 0, "not_executed": 0}

        batch = client.post(
            f"/api/test-groups/{group_id}/manual-test-result-batches",
            json={
                "results": [
                    {
                        "source_test_case_id": source_ids["SRC-MANUAL"],
                        "status": "passed",
                        "actual_result": "样例外观正常",
                        "attachments": [
                            {
                                "filename": "fixed-evidence.txt",
                                "content_type": "text/plain",
                                "content_base64": base64.b64encode(b"fixed sample evidence").decode(),
                            }
                        ],
                    }
                ]
            },
        )
        assert batch.status_code == 201, batch.text
        assert any(item["status"] == "not_executed" for item in batch.json()["report_input"])

        report = client.post(
            f"/api/test-groups/{group_id}/fact-reports",
            json={"automation_execution_id": execution.json()["id"], "manual_batch_ids": [batch.json()["id"]]},
        )
        assert report.status_code == 201, report.text
        report_body = report.json()
        assert report_body["analysis"] == {"status": "not_enabled", "message": "AI 分析未启用", "output": None}
        counts = report_body["snapshot"]["scope_overview"]["counts"]
        assert counts == {"passed": 2, "failed": 1, "blocked": 0, "not_executed": 1}
        for suffix in ("txt", "html"):
            downloaded = client.get(f"/api/fact-reports/{report_body['id']}.{suffix}")
            assert downloaded.status_code == 200, downloaded.text
            assert "阶段推进事实依据" in downloaded.text

        # 分析服务故障不能影响已保存的报告事实。
        class UnavailableAdapter:
            def generate_json(self, **_kwargs):
                raise TimeoutError("固定样例模拟服务不可用")

        monkeypatch.setenv("REPORT_ANALYSIS_MODE", "configured")
        monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")
        monkeypatch.setenv("DEEPSEEK_API_KEY", "ci-only-key")
        monkeypatch.setattr("app.report_analysis.get_provider_adapter", lambda _provider: UnavailableAdapter())
        failed_analysis = client.post(f"/api/fact-reports/{report_body['id']}/analysis")
        assert failed_analysis.status_code == 201
        assert failed_analysis.json() == {"status": "failed", "message": "分析未完成：模型服务不可用", "output": None}
        assert client.get(f"/api/fact-reports/{report_body['id']}").json()["snapshot"] == report_body["snapshot"]

        # 仅清理报告已使用附件，随后人工结果更新使报告过期；趋势仍从该最终报告读取。
        impact = client.get(f"/api/fact-reports/{report_body['id']}/attachment-cleanup-impact")
        assert impact.status_code == 200 and impact.json()["attachment_count"] == 1
        assert client.delete(f"/api/fact-reports/{report_body['id']}/used-attachments?confirm=true").status_code == 204
        cleaned = client.get(f"/api/fact-reports/{report_body['id']}").json()
        assert cleaned["attachment_summary"]["attachments"][0]["storage_status"] == "cleaned"
        assert (
            client.put(
                f"/api/manual-test-result-batches/{batch.json()['id']}",
                json={"results": [{"source_test_case_id": source_ids["SRC-MANUAL"], "status": "passed"}]},
            ).status_code
            == 200
        )
        assert client.get(f"/api/fact-reports/{report_body['id']}").json()["lifecycle_status"] == "stale"
        trend = client.get(f"/api/projects/{project.json()['id']}/trends")
        assert trend.status_code == 200 and trend.json()["points"][0]["report_id"] == report_body["id"]
        assert trend.json()["points"][0]["lifecycle_status"] == "stale"
        assert client.delete(f"/api/fact-reports/{report_body['id']}").status_code == 204
        assert client.get(f"/api/projects/{project.json()['id']}/trends").json()["status"] == "empty"
