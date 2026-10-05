import base64
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def _wait_for_completed_run(client: TestClient, run_id: int) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        current = client.get(f"/api/runs/{run_id}").json()["status"]
        if current == "completed":
            return
        assert current not in {"failed", "cancelled", "interrupted"}
        time.sleep(0.01)
    raise AssertionError("数据任务未在测试时间内完成")


def _create_ready_group(client: TestClient) -> tuple[int, int, int, int, int]:
    task = client.post("/api/collection-tasks", json={"name": "正常数据", "mode": "quick", "scenario": "normal"}).json()
    run_id = client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"]
    _wait_for_completed_run(client, run_id)
    package_id = client.get("/api/data-packages?data_kind=normal").json()["items"][0]["id"]
    project = client.post("/api/projects", json={"name": "Atlas", "product_name": "Camera"}).json()
    version = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()
    client.post(
        f"/api/product-versions/{version['id']}/source-test-case-imports",
        json={
            "source_filename": "cases.csv",
            "field_mapping": {"case_number": "编号", "title": "标题", "test_type": "类型", "module": "模块"},
            "rows": [{"编号": "SRC-001", "标题": "录制", "类型": "mixed", "模块": "采集"}],
        },
    )
    automation = client.post(f"/api/product-versions/{version['id']}/automation-test-case-conversions/rules").json()[
        "items"
    ][0]
    assert client.post(f"/api/product-versions/{version['id']}/automation-test-cases/validate").json()["valid"]
    group = client.post(f"/api/product-versions/{version['id']}/test-groups", json={"name": "基础回归"}).json()
    client.post(f"/api/test-groups/{group['id']}/automation-test-cases", json={"case_ids": [automation["id"]]})
    client.put(
        f"/api/test-groups/{group['id']}/automation-test-cases/{automation['id']}/data-packages",
        json={"data_package_ids": [package_id]},
    )
    source_case = client.get(f"/api/product-versions/{version['id']}/source-test-cases").json()["items"][0]
    client.post(f"/api/test-groups/{group['id']}/source-test-cases", json={"case_ids": [source_case["id"]]})
    return group["id"], version["id"], automation["id"], source_case["id"], package_id


def _create_report(client: TestClient, group_id: int, execution_id: int, batch_id: int) -> dict:
    response = client.post(
        f"/api/test-groups/{group_id}/fact-reports",
        json={"automation_execution_id": execution_id, "manual_batch_ids": [batch_id]},
    )
    assert response.status_code == 201
    return response.json()


def test_online_report_lifecycle_attachment_cleanup_and_history(client: TestClient):
    group_id, version_id, automation_id, source_case_id, package_id = _create_ready_group(client)
    execution = client.post(f"/api/test-groups/{group_id}/automation-executions").json()
    batch = client.post(
        f"/api/test-groups/{group_id}/manual-test-result-batches",
        json={
            "results": [
                {
                    "source_test_case_id": source_case_id,
                    "status": "failed",
                    "actual_result": "按键无响应",
                    "attachments": [
                        {
                            "filename": "evidence.txt",
                            "content_type": "text/plain",
                            "content_base64": base64.b64encode(b"evidence").decode(),
                        }
                    ],
                }
            ]
        },
    ).json()

    first = _create_report(client, group_id, execution["id"], batch["id"])
    assert first["lifecycle_status"] == "current"
    assert first["attachment_summary"]["attachment_count"] == 1
    assert first["attachment_summary"]["total_size_bytes"] == len(b"evidence")
    attachment_id = first["attachment_summary"]["attachments"][0]["id"]
    impact = client.get(f"/api/fact-reports/{first['id']}/attachment-cleanup-impact")
    assert impact.json()["attachments"][0]["storage_status"] == "stored"
    assert client.delete(f"/api/fact-reports/{first['id']}/used-attachments").status_code == 422
    assert client.delete(f"/api/fact-reports/{first['id']}/used-attachments?confirm=true").status_code == 204
    assert client.get(f"/api/manual-test-attachments/{attachment_id}/download").status_code == 404
    cleaned = client.get(f"/api/fact-reports/{first['id']}").json()
    assert cleaned["attachment_summary"]["attachments"] == [
        {
            "id": attachment_id,
            "filename": "evidence.txt",
            "content_type": "text/plain",
            "size_bytes": len(b"evidence"),
            "storage_status": "cleaned",
            "usage_status": "used",
        }
    ]
    assert (
        client.get(f"/api/test-groups/{group_id}/manual-test-result-batches").json()["batches"][0]["results"][0][
            "actual_result"
        ]
        == "按键无响应"
    )
    downloaded_text = client.get(f"/api/fact-reports/{first['id']}.txt").text
    assert "evidence.txt：已使用；已清理" in downloaded_text

    second = _create_report(client, group_id, execution["id"], batch["id"])
    assert client.get(f"/api/fact-reports/{first['id']}").json()["lifecycle_status"] == "superseded"
    assert second["lifecycle_status"] == "current"
    assert (
        client.post(
            f"/api/product-versions/{version_id}/source-test-case-imports",
            json={
                "source_filename": "extra.csv",
                "field_mapping": {"case_number": "编号", "title": "标题", "test_type": "类型"},
                "rows": [{"编号": "SRC-002", "标题": "指示灯", "类型": "manual"}],
            },
        ).status_code
        == 201
    )
    extra_case_id = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"][-1]["id"]
    add_member = client.post(f"/api/test-groups/{group_id}/source-test-cases", json={"case_ids": [extra_case_id]})
    assert add_member.status_code == 200
    assert client.get(f"/api/fact-reports/{second['id']}").json()["lifecycle_status"] == "stale"

    third = _create_report(client, group_id, execution["id"], batch["id"])
    assert (
        client.put(
            f"/api/test-groups/{group_id}/automation-test-cases/{automation_id}/data-packages",
            json={"data_package_ids": []},
        ).status_code
        == 200
    )
    assert client.get(f"/api/fact-reports/{third['id']}").json()["lifecycle_status"] == "stale"

    assert (
        client.put(
            f"/api/test-groups/{group_id}/automation-test-cases/{automation_id}/data-packages",
            json={"data_package_ids": [package_id]},
        ).status_code
        == 200
    )
    fourth = _create_report(client, group_id, execution["id"], batch["id"])
    later_execution = client.post(f"/api/test-groups/{group_id}/automation-executions").json()
    assert client.get(f"/api/fact-reports/{fourth['id']}").json()["lifecycle_status"] == "stale"
    fifth = _create_report(client, group_id, later_execution["id"], batch["id"])
    assert (
        client.put(
            f"/api/manual-test-result-batches/{batch['id']}",
            json={"results": [{"source_test_case_id": source_case_id, "status": "passed"}]},
        ).status_code
        == 200
    )
    assert client.get(f"/api/fact-reports/{fifth['id']}").json()["lifecycle_status"] == "stale"

    history = client.get(f"/api/test-groups/{group_id}/report-history?query=报告").json()["items"]
    assert {item["record_type"] for item in history} == {"fact_report"}
    all_history = client.get(f"/api/test-groups/{group_id}/report-history").json()["items"]
    assert {item["record_type"] for item in all_history} == {"automation_execution", "manual_result", "fact_report"}
    assert client.delete(f"/api/fact-reports/{fifth['id']}").status_code == 204
    assert client.get(f"/api/fact-reports/{fifth['id']}").status_code == 404
    assert client.get(f"/api/automation-executions/{later_execution['id']}").status_code == 200
    assert client.get(f"/api/test-groups/{group_id}/manual-test-result-batches").status_code == 200
