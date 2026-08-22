import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def test_engineer_can_create_and_reopen_quick_normal_collection_task(client):
    create_response = client.post(
        "/api/collection-tasks",
        json={"name": "面试快速正常采集", "mode": "quick", "scenario": "normal"},
    )

    assert create_response.status_code == 201
    created_task = create_response.json()
    assert created_task["id"] > 0
    assert created_task["name"] == "面试快速正常采集"
    assert created_task["mode"] == "quick"
    assert created_task["scenario"] == "normal"
    assert created_task["status"] == "draft"

    detail_response = client.get(f"/api/collection-tasks/{created_task['id']}")

    assert detail_response.status_code == 200
    assert detail_response.json() == created_task


def test_saved_collection_task_remains_visible_in_task_list(client):
    created_task = client.post(
        "/api/collection-tasks",
        json={"name": "刷新后仍可查看", "mode": "quick", "scenario": "normal"},
    ).json()

    list_response = client.get("/api/collection-tasks")

    assert list_response.status_code == 200
    assert list_response.json() == [created_task]


def test_invalid_collection_task_is_rejected_without_being_saved(client):
    invalid_response = client.post(
        "/api/collection-tasks",
        json={"name": "   ", "mode": "quick", "scenario": "normal"},
    )

    assert invalid_response.status_code == 422
    assert "任务名称不能为空" in invalid_response.text
    assert client.get("/api/collection-tasks").json() == []
