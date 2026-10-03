import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def _wait_for_completed_run(client: TestClient, run_id: int) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        if run["status"] in {"failed", "cancelled", "interrupted"}:
            raise AssertionError(f"运行未完成：{run}")
        time.sleep(0.01)
    raise AssertionError("运行未在测试时间内完成")


def _create_task(client: TestClient, name: str, scenario: str = "normal") -> dict:
    response = client.post(
        "/api/collection-tasks",
        json={"name": name, "mode": "quick", "scenario": scenario},
    )
    assert response.status_code == 201
    return response.json()


def test_completed_v010_runs_become_immutable_validated_data_packages(client):
    task = _create_task(client, "数据包来源任务")
    first_run = _wait_for_completed_run(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
    second_run = _wait_for_completed_run(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    packages = client.get("/api/data-packages?source_type=generated&data_kind=normal").json()["items"]

    assert len(packages) == 2
    assert {item["source_run_id"] for item in packages} == {first_run["id"], second_run["id"]}
    assert {item["validation_status"] for item in packages} == {"passed"}
    assert len({item["id"] for item in packages}) == 2
    assert all(item["version_fingerprint"] for item in packages)
    updates = {item["source_run_id"]: item["has_newer_source_result"] for item in packages}
    assert updates == {first_run["id"]: True, second_run["id"]: False}

    detail = client.get(f"/api/data-packages/{packages[0]['id']}")
    assert detail.status_code == 200
    assert {file["kind"] for file in detail.json()["files"]} >= {"video", "imu"}
    assert detail.json()["channels"] == ["camera_1", "camera_2"]
    assert detail.json()["integrity"]["status"] == "passed"


def test_fault_packages_can_be_filtered_by_specific_fault_type(client):
    task = _create_task(client, "掉帧故障数据", "video_drop")
    _wait_for_completed_run(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    response = client.get("/api/data-packages?data_kind=fault&fault_type=video_drop")

    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["fault_type"] == "video_drop"
    assert response.json()["items"][0]["eligible_for_test_group"] is True


def test_historical_completed_v010_run_can_be_registered_without_changing_its_record(client):
    task = _create_task(client, "历史运行补登记")
    run = _wait_for_completed_run(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
    from app.database import open_database

    with open_database() as connection:
        connection.execute("DELETE FROM data_packages WHERE source_run_id = ?", (run["id"],))

    response = client.post("/api/data-packages/register-completed-runs")
    retained = client.get(f"/api/runs/{run['id']}")

    assert response.status_code == 200
    assert [item["source_run_id"] for item in response.json()["items"]] == [run["id"]]
    assert retained.json()["artifacts"] == run["artifacts"]
    assert retained.json()["events"] == run["events"]


def test_data_package_deletion_requires_impact_preview_and_does_not_touch_v010_run(client):
    task = _create_task(client, "可删除包来源")
    run = _wait_for_completed_run(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
    package = client.get("/api/data-packages").json()["items"][0]

    missing_preview = client.delete(f"/api/data-packages/{package['id']}")
    preview = client.get(f"/api/data-packages/{package['id']}/deletion-impact")

    assert missing_preview.status_code == 400
    assert preview.status_code == 200
    assert preview.json()["association_counts"] == {
        "test_groups": 0,
        "automation_test_cases": 0,
        "automation_execution_records": 0,
    }
    assert client.delete(f"/api/data-packages/{package['id']}?confirm=true").status_code == 204
    assert client.get(f"/api/runs/{run['id']}").status_code == 200
