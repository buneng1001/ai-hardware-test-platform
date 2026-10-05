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
        status = client.get(f"/api/runs/{run_id}").json()["status"]
        if status == "completed":
            return
        if status in {"failed", "cancelled", "interrupted"}:
            raise AssertionError(f"数据任务未完成：{status}")
        time.sleep(0.01)
    raise AssertionError("数据任务未在测试时间内完成")


def _create_version_with_cases(client: TestClient) -> tuple[int, list[int]]:
    project = client.post("/api/projects", json={"name": "Atlas", "product_name": "Camera"}).json()
    version = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()
    response = client.post(
        f"/api/product-versions/{version['id']}/source-test-case-imports",
        json={
            "source_filename": "cases.csv",
            "field_mapping": {"case_number": "编号", "title": "标题", "software_version": "软件版本"},
            "rows": [
                {"编号": "SRC-001", "标题": "录制", "软件版本": "EVT0"},
                {"编号": "SRC-002", "标题": "回放", "软件版本": "EVT1"},
            ],
        },
    )
    assert response.status_code == 201
    cases = client.get(f"/api/product-versions/{version['id']}/source-test-cases").json()["items"]
    return version["id"], [item["id"] for item in cases]


def _create_valid_data_package(client: TestClient) -> int:
    task = client.post(
        "/api/collection-tasks", json={"name": "测试组数据", "mode": "quick", "scenario": "normal"}
    ).json()
    run_id = client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"]
    _wait_for_completed_run(client, run_id)
    return client.get("/api/data-packages").json()["items"][0]["id"]


def test_test_group_carries_selection_and_only_accepts_validated_automation_cases(client):
    version_id, source_ids = _create_version_with_cases(client)
    assert (
        client.put(
            f"/api/product-versions/{version_id}/source-test-case-selection",
            json={"source_test_case_ids": [source_ids[1]]},
        ).status_code
        == 200
    )

    created = client.post(f"/api/product-versions/{version_id}/test-groups", json={"name": "基础回归"})
    assert created.status_code == 201
    group = created.json()
    assert [item["id"] for item in group["source_test_cases"]] == [source_ids[1]]

    automation = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules").json()[
        "items"
    ]
    rejected = client.post(
        f"/api/test-groups/{group['id']}/automation-test-cases", json={"case_ids": [automation[0]["id"]]}
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"] == "自动化用例必须属于当前版本且已校验通过"

    assert client.post(f"/api/product-versions/{version_id}/automation-test-cases/validate").json()["valid"] is True
    detail = client.post(
        f"/api/test-groups/{group['id']}/automation-test-cases", json={"case_ids": [automation[0]["id"]]}
    ).json()
    assert detail["automation_test_cases"][0]["case_number"].startswith("AUTO-")
    assert detail["automation_test_cases"][0]["position"] == 1

    second = client.post(
        f"/api/product-versions/{version_id}/test-groups",
        json={"name": "故障专项", "include_selected_source_cases": False},
    ).json()
    assert (
        client.post(
            f"/api/test-groups/{second['id']}/automation-test-cases", json={"case_ids": [automation[0]["id"]]}
        ).status_code
        == 200
    )
    page = client.get(
        f"/api/product-versions/{version_id}/test-groups?search=专项&sort=name_asc&page=1&page_size=1"
    ).json()
    assert page["total"] == 1
    assert page["items"][0]["name"] == "故障专项"
    assert (
        client.patch(f"/api/test-groups/{group['id']}", json={"description": "基础覆盖"}).json()["description"]
        == "基础覆盖"
    )
    assert client.post(f"/api/test-groups/{group['id']}/hide").json()["hidden"] is True
    assert client.get(f"/api/product-versions/{version_id}/test-groups?hidden=false").json()["total"] == 1
    assert client.post(f"/api/test-groups/{group['id']}/restore").json()["hidden"] is False


def test_data_package_assignments_are_scoped_to_one_group_and_keep_warnings(client):
    version_id, _ = _create_version_with_cases(client)
    automation = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules").json()[
        "items"
    ]
    assert client.post(f"/api/product-versions/{version_id}/automation-test-cases/validate").json()["valid"] is True
    package_id = _create_valid_data_package(client)
    groups = [
        client.post(f"/api/product-versions/{version_id}/test-groups", json={"name": name}).json()
        for name in ("回归", "专项")
    ]
    for group in groups:
        assert (
            client.post(
                f"/api/test-groups/{group['id']}/automation-test-cases",
                json={"case_ids": [automation[0]["id"], automation[1]["id"]]},
            ).status_code
            == 200
        )
        assert (
            client.post(
                f"/api/test-groups/{group['id']}/data-package-assignments",
                json={
                    "automation_test_case_ids": [automation[0]["id"], automation[1]["id"]],
                    "data_package_id": package_id,
                },
            ).status_code
            == 200
        )

    detail = client.get(f"/api/test-groups/{groups[0]['id']}").json()
    package = detail["automation_test_cases"][0]["data_packages"][0]
    assert "软件版本为 EVT0" in package["warnings"][0]
    assert (
        client.put(
            f"/api/test-groups/{groups[0]['id']}/automation-test-cases/{automation[0]['id']}/data-packages",
            json={"data_package_ids": []},
        ).status_code
        == 200
    )
    assert (
        client.get(f"/api/test-groups/{groups[1]['id']}").json()["automation_test_cases"][0]["data_packages"][0]["id"]
        == package_id
    )

    impact = client.get(f"/api/data-packages/{package_id}/deletion-impact").json()
    assert impact["association_counts"]["test_groups"] == 2
    assert impact["association_counts"]["automation_test_cases"] == 2
    assert (
        client.delete(f"/api/test-groups/{groups[1]['id']}/automation-test-cases/{automation[0]['id']}").status_code
        == 204
    )
    assert client.get(f"/api/test-groups/{groups[1]['id']}").json()["data_package_assignment_count"] == 1
    assert (
        client.post(
            f"/api/test-groups/{groups[1]['id']}/automation-test-cases", json={"case_ids": [automation[0]["id"]]}
        ).status_code
        == 200
    )
    readded = client.get(f"/api/test-groups/{groups[1]['id']}").json()["automation_test_cases"]
    assert next(item for item in readded if item["id"] == automation[0]["id"])["data_packages"] == []
    deleted = client.delete(f"/api/test-groups/{groups[0]['id']}")
    assert deleted.status_code == 400
    group_impact = client.get(f"/api/test-groups/{groups[0]['id']}/deletion-impact").json()
    assert group_impact["automation_test_cases"] == 2
    assert group_impact["manual_test_results"] == 0
    assert group_impact["manual_test_result_attachments"] == 0
    assert client.delete(f"/api/test-groups/{groups[0]['id']}?confirm=true").status_code == 204
