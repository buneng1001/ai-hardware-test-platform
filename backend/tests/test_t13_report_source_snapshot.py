"""V030-T13: final report source selection and immutable historical comparisons."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "disabled")
    with TestClient(app) as test_client:
        yield test_client


def _create_group(client: TestClient, *, project_id: int | None = None, version: str = "EVT1"):
    if project_id is None:
        project = client.post("/api/projects", json={"name": f"T13 项目 {version}", "product_name": "Recorder"}).json()
        project_id = project["id"]
    result = client.post(f"/api/projects/{project_id}/product-versions", json={"version": version})
    assert result.status_code == 201, result.text
    version_id = result.json()["id"]
    result = client.post(f"/api/product-versions/{version_id}/test-groups", json={"name": f"{version} 测试组"})
    assert result.status_code == 201, result.text
    return project_id, version_id, result.json()["id"]


def _batch(client: TestClient, version_id: int, group_id: int, status: str):
    imported = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={
            "source_filename": "manual.csv",
            "field_mapping": {"case_number": "编号", "title": "标题", "test_type": "类型", "module": "模块"},
            "rows": [{"编号": "SRC-01", "标题": "人工验证", "类型": "manual", "模块": "核心"}],
        },
    )
    assert imported.status_code == 201, imported.text
    case_id = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"][0]["id"]
    joined = client.post(f"/api/test-groups/{group_id}/source-test-cases", json={"case_ids": [case_id]})
    assert joined.status_code == 200, joined.text
    created = client.post(
        f"/api/test-groups/{group_id}/manual-test-result-batches",
        json={"results": [{"source_test_case_id": case_id, "status": status, "actual_result": status}]},
    )
    assert created.status_code == 201, created.text
    return case_id, created.json()["id"]


def _report(client: TestClient, group_id: int, **sources):
    return client.post(f"/api/test-groups/{group_id}/fact-reports", json=sources)


def test_t13_manual_multi_select_none_and_independent_historical_statistics(client):
    project_id, version_id, group_id = _create_group(client)
    case_id, batch_1 = _batch(client, version_id, group_id, "failed")
    batch_2_response = client.post(
        f"/api/test-groups/{group_id}/manual-test-result-batches",
        json={"results": [{"source_test_case_id": case_id, "status": "passed", "actual_result": "passed"}]},
    )
    assert batch_2_response.status_code == 201
    batch_2 = batch_2_response.json()["id"]

    first = _report(client, group_id, automation_execution_id=None, manual_batch_ids=[batch_1])
    assert first.status_code == 201, first.text
    origin = first.json()
    assert origin["snapshot"]["pass_rate"]["overall"]["failed"] == 1
    multi = _report(
        client,
        group_id,
        automation_execution_id=None,
        manual_batch_ids=[batch_1, batch_2],
        historical_report_ids=[],
    )
    assert multi.status_code == 201, multi.text
    assert multi.json()["manual_batch_ids"] == [batch_1, batch_2]
    assert multi.json()["snapshot"]["pass_rate"]["overall"]["total"] == 2
    assert multi.json()["snapshot"]["pass_rate"]["overall"]["failed"] == 1
    assert multi.json()["snapshot"]["pass_rate"]["overall"]["passed"] == 1
    assert multi.json()["snapshot"]["basic_information"]["automation_execution"] is None

    _, _, newer_group = _create_group(client, project_id=project_id, version="EVT2")
    candidates = client.get(f"/api/test-groups/{newer_group}/historical-fact-reports")
    assert candidates.status_code == 200
    assert {item["id"] for item in candidates.json()["items"]} == {origin["id"], multi.json()["id"]}

    comparison = _report(
        client,
        newer_group,
        automation_execution_id=None,
        manual_batch_ids=[],
        historical_report_ids=[origin["id"], multi.json()["id"]],
    )
    assert comparison.status_code == 201, comparison.text
    document = comparison.json()
    assert document["historical_report_ids"] == [origin["id"], multi.json()["id"]]
    assert document["snapshot"]["pass_rate"]["overall"]["total"] == 0
    assert document["snapshot"]["pass_rate"]["overall"]["rate"] is None
    assert document["snapshot"]["scope_overview"]["counts"]["failed"] == 0
    assert document["snapshot"]["basic_information"]["product_version"] == "EVT2"
    historical = document["snapshot"]["historical_reports"]
    assert [item["product_version"] for item in historical] == ["EVT1", "EVT1"]
    assert [item["test_group"] for item in historical] == ["EVT1 测试组", "EVT1 测试组"]
    assert [item["report_id"] for item in historical] == [origin["id"], multi.json()["id"]]
    assert historical[0]["statistics_snapshot"]["pass_rate"] == origin["snapshot"]["pass_rate"]
    assert historical[1]["statistics_snapshot"]["pass_rate"] == multi.json()["snapshot"]["pass_rate"]
    exported_html = client.get(f"/api/fact-reports/{document['id']}.html").text
    assert "历史最终报告对照" in exported_html
    assert '<p class="rate">无可统计结果</p>' in exported_html  # 当前报告不可借用历史通过率
    assert "50.0%" in exported_html  # 历史报告保留自身通过率
    assert f"报告 #{origin['id']}" in client.get(f"/api/fact-reports/{document['id']}.txt").text

    # 来源报告删除不会改变已生成的历史统计快照。
    assert client.delete(f"/api/fact-reports/{origin['id']}").status_code == 204
    again = client.get(f"/api/fact-reports/{document['id']}").json()
    assert again["snapshot"]["historical_reports"] == historical


def test_t13_rejects_empty_duplicate_cross_project_and_invalid_historical_source(client):
    project_id, version_id, group_id = _create_group(client)
    _, batch_id = _batch(client, version_id, group_id, "blocked")
    origin = _report(client, group_id, automation_execution_id=None, manual_batch_ids=[batch_id]).json()
    _, _, group_other_version = _create_group(client, project_id=project_id, version="EVT2")
    _, _, other_project_group = _create_group(client, version="EVT9")

    assert _report(client, group_other_version, automation_execution_id=None, manual_batch_ids=[]).status_code == 422
    assert (
        _report(
            client,
            group_other_version,
            automation_execution_id=None,
            manual_batch_ids=[],
            historical_report_ids=[origin["id"], origin["id"]],
        ).status_code
        == 422
    )
    assert (
        _report(
            client,
            group_other_version,
            automation_execution_id=None,
            manual_batch_ids=[],
            historical_report_ids=[999999],
        ).status_code
        == 422
    )
    assert (
        _report(
            client,
            other_project_group,
            automation_execution_id=None,
            manual_batch_ids=[],
            historical_report_ids=[origin["id"]],
        ).status_code
        == 422
    )
    assert (
        _report(
            client,
            group_other_version,
            automation_execution_id=None,
            manual_batch_ids=[],
            historical_report_ids=[0],
        ).status_code
        == 422
    )
