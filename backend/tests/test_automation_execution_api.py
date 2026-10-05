import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from app.database import open_database
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def _wait_for_completed_run(client: TestClient, run_id: int) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        status = client.get(f"/api/runs/{run_id}").json()["status"]
        if status == "completed":
            return
        assert status not in {"failed", "cancelled", "interrupted"}
        time.sleep(0.01)
    raise AssertionError("数据任务未在测试时间内完成")


def _create_data_package(client: TestClient, scenario: str = "normal") -> int:
    task = client.post(
        "/api/collection-tasks", json={"name": f"{scenario} 数据", "mode": "quick", "scenario": scenario}
    ).json()
    run_id = client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"]
    _wait_for_completed_run(client, run_id)
    kind = "normal" if scenario == "normal" else "fault"
    packages = client.get(f"/api/data-packages?data_kind={kind}").json()["items"]
    return packages[0]["id"]


def _create_ready_group(client: TestClient, package_ids: list[int]) -> tuple[int, int]:
    project = client.post("/api/projects", json={"name": "Atlas", "product_name": "Camera"}).json()
    version = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()
    assert (
        client.post(
            f"/api/product-versions/{version['id']}/source-test-case-imports",
            json={
                "source_filename": "cases.csv",
                "field_mapping": {"case_number": "编号", "title": "标题", "test_type": "类型", "module": "模块"},
                "rows": [{"编号": "SRC-001", "标题": "录制", "类型": "mixed", "模块": "采集"}],
            },
        ).status_code
        == 201
    )
    automation = client.post(f"/api/product-versions/{version['id']}/automation-test-case-conversions/rules").json()[
        "items"
    ][0]
    assert client.post(f"/api/product-versions/{version['id']}/automation-test-cases/validate").json()["valid"]
    group = client.post(f"/api/product-versions/{version['id']}/test-groups", json={"name": "基础回归"}).json()
    assert (
        client.post(
            f"/api/test-groups/{group['id']}/automation-test-cases", json={"case_ids": [automation["id"]]}
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/test-groups/{group['id']}/automation-test-cases/{automation['id']}/data-packages",
            json={"data_package_ids": package_ids},
        ).status_code
        == 200
    )
    return group["id"], automation["id"]


def test_preparation_returns_actionable_failures_without_creating_execution(client):
    project = client.post("/api/projects", json={"name": "Atlas", "product_name": "Camera"}).json()
    version = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()
    group = client.post(f"/api/product-versions/{version['id']}/test-groups", json={"name": "空组"}).json()

    preparation = client.post(f"/api/test-groups/{group['id']}/automation-execution-preparations")

    assert preparation.status_code == 200
    payload = preparation.json()
    assert payload["passed"] is False
    assert payload["checks"] == [
        {
            "code": "PREP_GROUP_EMPTY",
            "object_type": "test_group",
            "object_id": group["id"],
            "actual": "0 个自动化用例",
            "expected": "至少 1 个已校验自动化用例",
            "suggestion": "在测试组中加入已校验自动化用例。",
            "action": "edit_group",
        }
    ]
    assert client.get(f"/api/test-groups/{group['id']}/automation-executions").json()["items"] == []


def test_execution_creates_immutable_snapshots_and_fault_data_fails_case(client):
    normal_package_id = _create_data_package(client)
    group_id, _ = _create_ready_group(client, [normal_package_id])

    assert client.post(f"/api/test-groups/{group_id}/automation-execution-preparations").json()["passed"] is True
    first = client.post(f"/api/test-groups/{group_id}/automation-executions")
    assert first.status_code == 201
    first_record = first.json()
    assert first_record["execution_number"] == 1
    assert first_record["status"] == "completed"
    assert first_record["summary"] == {"passed": 1, "failed": 0, "blocked": 0, "not_executed": 0}
    assert first_record["group_snapshot"]["name"] == "基础回归"
    assert first_record["case_results"][0]["case_snapshot"]["module"] == "采集"
    assert first_record["case_results"][0]["status"] == "passed"

    second_normal = client.post(f"/api/test-groups/{group_id}/automation-executions")
    assert second_normal.status_code == 201
    assert second_normal.json()["execution_number"] == 2
    assert second_normal.json()["summary"] == first_record["summary"]
    assert second_normal.json()["case_results"] == first_record["case_results"]

    with open_database() as connection:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE automation_execution_records SET summary = '{}' WHERE id = ?", (first_record["id"],)
            )

    assert client.patch(f"/api/test-groups/{group_id}", json={"name": "已经变更"}).status_code == 200
    persisted = client.get(f"/api/automation-executions/{first_record['id']}").json()
    assert persisted["group_snapshot"]["name"] == "基础回归"

    fault_package_id = _create_data_package(client, "video_drop")
    detail = client.get(f"/api/test-groups/{group_id}").json()
    case_id = detail["automation_test_cases"][0]["id"]
    assert (
        client.put(
            f"/api/test-groups/{group_id}/automation-test-cases/{case_id}/data-packages",
            json={"data_package_ids": [fault_package_id]},
        ).status_code
        == 200
    )
    second = client.post(f"/api/test-groups/{group_id}/automation-executions")
    assert second.status_code == 201
    second_record = second.json()
    assert second_record["execution_number"] == 3
    assert second_record["summary"] == {"passed": 0, "failed": 1, "blocked": 0, "not_executed": 0}
    assert second_record["case_results"][0]["status"] == "failed"
    assert "确定性检查实际结果" in second_record["case_results"][0]["message"]
    assert (
        client.get(f"/api/data-packages/{fault_package_id}/deletion-impact").json()["association_counts"][
            "automation_execution_records"
        ]
        == 1
    )
    cancelled = client.post(f"/api/test-groups/{group_id}/automation-executions/cancelled")
    assert cancelled.status_code == 201
    assert cancelled.json()["execution_number"] == 4
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["summary"] == {"passed": 0, "failed": 0, "blocked": 0, "not_executed": 1}


def test_fact_report_combines_snapshots_marks_conflicts_and_downloads(client):
    normal_package_id = _create_data_package(client)
    group_id, _ = _create_ready_group(client, [normal_package_id])
    source_case_id = client.get(f"/api/test-groups/{group_id}").json()["source_test_cases"]
    if not source_case_id:
        version_id = client.get(f"/api/test-groups/{group_id}").json()["product_version_id"]
        source_case_id = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
        assert (
            client.post(
                f"/api/test-groups/{group_id}/source-test-cases", json={"case_ids": [source_case_id[0]["id"]]}
            ).status_code
            == 200
        )
    else:
        source_case_id = source_case_id
    execution = client.post(f"/api/test-groups/{group_id}/automation-executions").json()
    source_id = client.get(f"/api/product-versions/{execution['product_version_id']}/source-test-cases").json()[
        "items"
    ][0]["id"]
    batch = client.post(
        f"/api/test-groups/{group_id}/manual-test-result-batches",
        json={"results": [{"source_test_case_id": source_id, "status": "failed", "actual_result": "按键无响应"}]},
    ).json()
    manual_only = client.post(
        f"/api/test-groups/{group_id}/fact-reports", json={"manual_batch_ids": [batch["id"]]}
    ).json()
    assert manual_only["snapshot"]["basic_information"]["contains"] == "人工结果"

    created = client.post(
        f"/api/test-groups/{group_id}/fact-reports",
        json={"automation_execution_id": execution["id"], "manual_batch_ids": [batch["id"]]},
    )
    assert created.status_code == 201
    report = created.json()
    assert report["snapshot"]["basic_information"]["contains"] == "自动化和人工结果"
    assert report["snapshot"]["modules"][0]["name"] == "采集"
    assert report["snapshot"]["cross_module_issues"][0]["case_number"] == "SRC-001"
    text = client.get(f"/api/fact-reports/{report['id']}.txt").text
    markup = client.get(f"/api/fact-reports/{report['id']}.html").text
    assert "结果不一致" in text
    assert [
        text.index(title)
        for title in ("测试基本信息", "阶段推进事实依据", "AI 区域状态", "范围总览", "模块详情", "跨模块问题")
    ] == sorted(
        text.index(title)
        for title in ("测试基本信息", "阶段推进事实依据", "AI 区域状态", "范围总览", "模块详情", "跨模块问题")
    )
    assert "模块详情" in markup
    assert markup.index("阶段推进事实依据") < markup.index("模块详情")
    assert (
        client.put(
            f"/api/manual-test-result-batches/{batch['id']}",
            json={"results": [{"source_test_case_id": source_id, "status": "passed"}]},
        ).status_code
        == 200
    )
    persisted = client.get(f"/api/fact-reports/{report['id']}").json()
    assert any(item["status"] == "failed" for item in persisted["snapshot"]["modules"][0]["records"])
    assert client.patch(f"/api/test-groups/{group_id}", json={"description": "当前配置已更新"}).status_code == 200
    refreshed = client.post(
        f"/api/test-groups/{group_id}/fact-reports",
        json={"automation_execution_id": execution["id"]},
    ).json()
    assert refreshed["snapshot"]["warnings"] == ["当前记录来自历史配置，报告将使用历史快照。"]
    other_group = client.post(
        f"/api/product-versions/{execution['product_version_id']}/test-groups", json={"name": "另一测试组"}
    ).json()
    assert (
        client.post(
            f"/api/test-groups/{other_group['id']}/fact-reports",
            json={"automation_execution_id": execution["id"]},
        ).status_code
        == 422
    )
    assert client.post(f"/api/test-groups/{group_id}/fact-reports", json={}).status_code == 422


def test_report_analysis_is_optional_persisted_and_never_changes_fact_report(client, monkeypatch):
    package_id = _create_data_package(client, "video_drop")
    group_id, _ = _create_ready_group(client, [package_id])
    execution = client.post(f"/api/test-groups/{group_id}/automation-executions").json()
    report = client.post(
        f"/api/test-groups/{group_id}/fact-reports", json={"automation_execution_id": execution["id"]}
    ).json()

    assert report["analysis"] == {"status": "not_enabled", "message": "AI 分析未启用", "output": None}
    assert client.post(f"/api/fact-reports/{report['id']}/analysis").json()["status"] == "not_enabled"

    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "mock")
    automatically_analyzed = client.post(
        f"/api/test-groups/{group_id}/fact-reports", json={"automation_execution_id": execution["id"]}
    ).json()
    assert automatically_analyzed["analysis"]["status"] == "pending"
    for _ in range(20):
        automatically_analyzed = client.get(f"/api/fact-reports/{automatically_analyzed['id']}").json()
        if automatically_analyzed["analysis"]["status"] == "completed":
            break
        time.sleep(0.01)
    assert automatically_analyzed["analysis"]["status"] == "completed"
    completed = client.post(f"/api/fact-reports/{report['id']}/analysis")

    assert completed.status_code == 201
    analysis = completed.json()
    assert analysis["status"] == "completed"
    assert (
        analysis["output"]["stage_recommendation"]["suggestion"]
        == "请依据已保存事实报告补充验证后，再决定是否推进阶段。"
    )
    assert analysis["output"]["risks"][0]["evidence_refs"]
    persisted = client.get(f"/api/fact-reports/{report['id']}").json()
    assert persisted["snapshot"] == report["snapshot"]
    assert persisted["analysis"]["status"] == "completed"

    class InvalidOutputAdapter:
        def generate_json(self, **_kwargs):
            return {
                "risks": [{"content": "未引用事实的风险", "evidence_refs": ["invented:threshold"]}],
                "additional_verifications": [],
                "regression_recommendations": [],
                "stage_recommendation": {
                    "suggestion": "建议暂停",
                    "content": "没有有效依据",
                    "evidence_refs": ["invented:threshold"],
                },
            }

    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "configured")
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setattr("app.report_analysis.get_provider_adapter", lambda _provider: InvalidOutputAdapter())
    failed = client.post(f"/api/fact-reports/{report['id']}/analysis").json()

    assert failed == {"status": "failed", "message": "分析未完成：模型分析结构无效", "output": None}
    assert client.get(f"/api/fact-reports/{report['id']}").json()["snapshot"] == report["snapshot"]

    from app.siliconflow import ModelErrorKind, SiliconFlowError

    class UnavailableAdapter:
        def generate_json(self, **_kwargs):
            raise SiliconFlowError(ModelErrorKind.TIMEOUT, "模型请求超时", True)

    monkeypatch.setattr("app.report_analysis.get_provider_adapter", lambda _provider: UnavailableAdapter())
    still_created = client.post(
        f"/api/test-groups/{group_id}/fact-reports", json={"automation_execution_id": execution["id"]}
    )
    unavailable = client.post(f"/api/fact-reports/{report['id']}/analysis").json()

    assert still_created.status_code == 201
    background_report = still_created.json()
    assert background_report["analysis"]["status"] == "pending"
    for _ in range(20):
        background_report = client.get(f"/api/fact-reports/{background_report['id']}").json()
        if background_report["analysis"]["status"] == "failed":
            break
        time.sleep(0.01)
    assert background_report["analysis"] == {"status": "failed", "message": "分析未完成：模型请求超时", "output": None}
    assert unavailable == {"status": "failed", "message": "分析未完成：模型请求超时", "output": None}
    assert client.get(f"/api/fact-reports/{report['id']}").json()["snapshot"] == report["snapshot"]


def test_preparation_detects_cases_edited_after_group_assignment(client):
    package_id = _create_data_package(client)
    group_id, case_id = _create_ready_group(client, [package_id])
    version_id = client.get(f"/api/test-groups/{group_id}").json()["product_version_id"]
    assert (
        client.patch(
            f"/api/product-versions/{version_id}/automation-test-cases/{case_id}", json={"title": "待重新校验"}
        ).status_code
        == 200
    )

    preparation = client.post(f"/api/test-groups/{group_id}/automation-execution-preparations").json()

    assert preparation["passed"] is False
    assert preparation["checks"][0]["code"] == "PREP_CASE_NOT_VALIDATED"
    assert preparation["checks"][0]["action"] == "edit_group"
    assert client.get(f"/api/test-groups/{group_id}/automation-executions").json()["items"] == []
