import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def test_engineer_can_create_open_and_edit_project_versions(client):
    project_response = client.post(
        "/api/projects",
        json={"name": "IRIS", "product_name": "多传感器记录仪", "description": "Beta 测试项目"},
    )

    assert project_response.status_code == 201
    project = project_response.json()
    assert project["name"] == "IRIS"
    assert project["product_name"] == "多传感器记录仪"
    assert project["product_versions"] == []

    version_response = client.post(
        f"/api/projects/{project['id']}/product-versions",
        json={"version": "EVT1"},
    )

    assert version_response.status_code == 201
    version = version_response.json()
    assert version["project_id"] == project["id"]
    assert version["version"] == "EVT1"
    assert version["name"] == ""
    assert version["description"] == ""

    edited_response = client.patch(
        f"/api/product-versions/{version['id']}",
        json={"name": "工程验证一版", "description": "首轮 Beta 验证"},
    )

    assert edited_response.status_code == 200
    assert edited_response.json()["name"] == "工程验证一版"
    detail = client.get(f"/api/projects/{project['id']}")
    assert detail.status_code == 200
    assert detail.json()["product_versions"] == [edited_response.json()]
    assert client.get(f"/api/product-versions/{version['id']}").json() == edited_response.json()


def test_project_list_supports_search_and_explicit_sorting(client):
    iris = client.post(
        "/api/projects",
        json={"name": "IRIS", "product_name": "Recorder", "description": ""},
    ).json()
    atlas = client.post(
        "/api/projects",
        json={"name": "Atlas", "product_name": "Camera", "description": ""},
    ).json()

    search_response = client.get("/api/projects", params={"search": "record"})
    assert search_response.status_code == 200
    assert [item["id"] for item in search_response.json()] == [iris["id"]]

    sorted_response = client.get("/api/projects", params={"sort": "name_asc"})
    assert sorted_response.status_code == 200
    assert [item["id"] for item in sorted_response.json()] == [atlas["id"], iris["id"]]


def test_deletion_requires_impact_preview_and_removes_only_confirmed_scope(client):
    project = client.post(
        "/api/projects",
        json={"name": "IRIS", "product_name": "Recorder", "description": ""},
    ).json()
    evt1 = client.post(
        f"/api/projects/{project['id']}/product-versions",
        json={"version": "EVT1", "name": "", "description": ""},
    ).json()
    evt2 = client.post(
        f"/api/projects/{project['id']}/product-versions",
        json={"version": "EVT2", "name": "", "description": ""},
    ).json()

    project_impact = client.get(f"/api/projects/{project['id']}/deletion-impact")
    assert project_impact.status_code == 200
    assert project_impact.json() == {
        "project_id": project["id"],
        "product_versions": [
            {"id": evt1["id"], "version": "EVT1", "name": ""},
            {"id": evt2["id"], "version": "EVT2", "name": ""},
        ],
        "asset_counts": {
            "source_test_cases": 0,
            "automation_test_cases": 0,
            "data_packages": 0,
            "test_groups": 0,
            "automation_execution_records": 0,
            "manual_test_records": 0,
            "online_reports": 0,
        },
        "total_affected_assets": 0,
    }

    version_impact = client.get(f"/api/product-versions/{evt1['id']}/deletion-impact")
    assert version_impact.status_code == 200
    assert version_impact.json()["product_version"]["version"] == "EVT1"
    assert version_impact.json()["total_affected_assets"] == 0

    assert client.delete(f"/api/product-versions/{evt1['id']}").status_code == 400
    assert client.delete(f"/api/product-versions/{evt1['id']}", params={"confirm": True}).status_code == 204
    assert client.get(f"/api/product-versions/{evt1['id']}").status_code == 404

    assert client.delete(f"/api/projects/{project['id']}").status_code == 400
    assert client.delete(f"/api/projects/{project['id']}", params={"confirm": True}).status_code == 204
    assert client.get(f"/api/projects/{project['id']}").status_code == 404


def test_project_without_final_reports_has_explicit_empty_trend_state(client):
    project = client.post(
        "/api/projects",
        json={"name": "IRIS", "product_name": "Recorder", "description": ""},
    ).json()

    response = client.get(f"/api/projects/{project['id']}/trends")

    assert response.status_code == 200
    assert response.json() == {
        "project_id": project["id"],
        "status": "empty",
        "message": "暂无趋势数据",
        "points": [],
    }


def test_duplicate_project_and_version_names_are_rejected_with_clear_conflicts(client):
    first_project = client.post(
        "/api/projects",
        json={"name": "IRIS", "product_name": "Recorder", "description": ""},
    )
    duplicate_project = client.post(
        "/api/projects",
        json={"name": " iris ", "product_name": "Other", "description": ""},
    )
    assert first_project.status_code == 201
    assert duplicate_project.status_code == 409

    project_id = first_project.json()["id"]
    first_version = client.post(
        f"/api/projects/{project_id}/product-versions",
        json={"version": "EVT1"},
    )
    duplicate_version = client.post(
        f"/api/projects/{project_id}/product-versions",
        json={"version": " evt1 "},
    )
    assert first_version.status_code == 201
    assert duplicate_version.status_code == 409
