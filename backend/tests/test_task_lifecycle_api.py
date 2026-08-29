import time

from fastapi.testclient import TestClient

from app.main import app


def _task(client: TestClient, name: str) -> dict:
    response = client.post(
        "/api/collection-tasks",
        json={"name": name, "mode": "quick", "scenario": "normal"},
    )
    assert response.status_code == 201
    return response.json()


def _wait_for_completion(client: TestClient, run_id: int) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        response = client.get(f"/api/runs/{run_id}")
        assert response.status_code == 200
        run = response.json()
        if run["status"] in {"completed", "failed", "cancelled", "interrupted"}:
            return run
        time.sleep(0.01)
    raise AssertionError("运行未在测试时间内结束")


def test_saved_task_read_model_supports_source_status_archive_filters_and_ten_item_pages(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        for index in range(12):
            _task(client, f"分页任务 {index}")

        response = client.get("/api/collection-tasks/saved?page=1&page_size=10&source=synthetic_generated")

    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 10
    assert body["page"] == 1
    assert body["page_size"] == 10
    assert body["total"] == 12
    assert {item["source"] for item in body["items"]} == {"synthetic_generated"}
    assert {item["execution_status"] for item in body["items"]} == {"never_executed"}
    assert all(item["archived"] is False for item in body["items"])


def test_task_lifecycle_deletes_never_run_and_archives_run_task_without_deleting_evidence(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        draft = _task(client, "可删除任务")
        assert client.delete(f"/api/collection-tasks/{draft['id']}").status_code == 204
        assert client.get(f"/api/collection-tasks/{draft['id']}").status_code == 404

        task = _task(client, "只可归档任务")
        run = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        completed = _wait_for_completion(client, run["id"])
        delete_response = client.delete(f"/api/collection-tasks/{task['id']}")
        assert delete_response.status_code == 409
        assert "只能归档" in delete_response.json()["detail"]

        archive_response = client.post(f"/api/collection-tasks/{task['id']}/archive")
        assert archive_response.status_code == 200
        assert archive_response.json()["archived"] is True
        saved = client.get(f"/api/collection-tasks/{task['id']}")
        assert saved.status_code == 200
        assert saved.json()["archived"] is True
        retained = client.get(f"/api/runs/{completed['id']}")

    assert retained.status_code == 200
    assert retained.json()["artifacts"] == completed["artifacts"]


def test_run_detail_exposes_task_name_execution_number_queue_position_and_stage(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        task = _task(client, "运行读模型任务")
        first = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        second = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        assert first["task_name"] == task["name"]
        assert first["task_execution_number"] == 1
        assert second["task_execution_number"] == 2
        assert first["queue_position"] >= 1
        assert second["queue_position"] >= 1
        assert second["stage_status"] == "queued"

        first_detail = client.get(f"/api/runs/{first['id']}").json()

    assert first_detail["task_name"] == task["name"]
    assert first_detail["task_execution_number"] == 1
