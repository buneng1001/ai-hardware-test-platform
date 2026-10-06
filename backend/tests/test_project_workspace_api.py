import json
import sqlite3

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
            "manual_test_result_batches": 0,
            "manual_test_results": 0,
            "manual_test_result_attachments": 0,
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


def _insert_final_report(
    tmp_path,
    *,
    group_id: int,
    version_id: int,
    created_at: str,
    lifecycle_status: str = "current",
    modules: list[dict],
) -> int:
    with sqlite3.connect(tmp_path / "platform.sqlite3") as connection:
        return connection.execute(
            """
            INSERT INTO online_reports
                (test_group_id, product_version_id, manual_batch_ids, snapshot, created_at, lifecycle_status)
            VALUES (?, ?, '[]', ?, ?, ?)
            """,
            (group_id, version_id, json.dumps({"modules": modules}), created_at, lifecycle_status),
        ).lastrowid


def _module(name: str, *records: dict) -> dict:
    return {"name": name, "records": list(records)}


def _record(case_number: str, source: str, status: str, title: str = "验证") -> dict:
    return {"case_number": case_number, "title": title, "source": source, "status": status}


def _create_version_group(client, project_id: int, version: str, group: str) -> tuple[dict, dict]:
    product_version = client.post(
        f"/api/projects/{project_id}/product-versions", json={"version": version}
    ).json()
    test_group = client.post(
        f"/api/product-versions/{product_version['id']}/test-groups", json={"name": group}
    ).json()
    return product_version, test_group


def test_project_trends_aggregate_only_final_reports_and_keep_stale_points(client, tmp_path):
    project = client.post(
        "/api/projects", json={"name": "IRIS", "product_name": "Recorder", "description": ""}
    ).json()
    version, group = _create_version_group(client, project["id"], "EVT1", "回归")
    report_id = _insert_final_report(
        tmp_path,
        group_id=group["id"],
        version_id=version["id"],
        created_at="2026-10-01T00:00:00+00:00",
        lifecycle_status="stale",
        modules=[
            _module(
                "采集",
                _record("SRC-001", "自动化", "passed"),
                _record("SRC-002", "人工", "blocked"),
            )
        ],
    )

    trend = client.get(f"/api/projects/{project['id']}/trends")

    assert trend.status_code == 200
    assert trend.json()["status"] == "single"
    assert trend.json()["points"] == [
        {
            "report_id": report_id,
            "product_version_id": version["id"],
            "product_version": "EVT1",
            "test_group_id": group["id"],
            "test_group": "回归",
            "created_at": "2026-10-01T00:00:00+00:00",
            "lifecycle_status": "stale",
            "counts": {
                "automation": {"passed": 1, "failed": 0, "blocked": 0, "not_executed": 0},
                "manual": {"passed": 0, "failed": 0, "blocked": 1, "not_executed": 0},
            },
            "modules": [
                {
                    "name": "采集",
                    "conclusion": "建议暂缓并补充验证",
                    "counts": {
                        "automation": {"passed": 1, "failed": 0, "blocked": 0, "not_executed": 0},
                        "manual": {"passed": 0, "failed": 0, "blocked": 1, "not_executed": 0},
                    },
                }
            ],
        }
    ]
    assert client.get(f"/api/projects/{project['id']}/trends?module=存储").json()["status"] == "filtered_empty"

    assert client.delete(f"/api/fact-reports/{report_id}").status_code == 204
    assert client.get(f"/api/projects/{project['id']}/trends").json()["status"] == "empty"


def test_project_trends_filter_by_version_module_group_and_case(client, tmp_path):
    project = client.post(
        "/api/projects", json={"name": "Atlas", "product_name": "Camera", "description": ""}
    ).json()
    first_version, first_group = _create_version_group(client, project["id"], "EVT1", "冒烟")
    second_version, second_group = _create_version_group(client, project["id"], "EVT2", "回归")
    _insert_final_report(
        tmp_path,
        group_id=first_group["id"],
        version_id=first_version["id"],
        created_at="2026-10-01T00:00:00+00:00",
        modules=[_module("采集", _record("SRC-001", "自动化", "passed"))],
    )
    second_report = _insert_final_report(
        tmp_path,
        group_id=second_group["id"],
        version_id=second_version["id"],
        created_at="2026-10-02T00:00:00+00:00",
        modules=[_module("存储", _record("SRC-002", "人工", "failed"))],
    )

    response = client.get(
        f"/api/projects/{project['id']}/trends",
        params={
            "product_version_id": second_version["id"],
            "module": "存储",
            "test_group_id": second_group["id"],
            "case_number": "SRC-002",
        },
    )

    assert response.status_code == 200
    assert response.json()["points"][0]["report_id"] == second_report
    assert response.json()["points"][0]["counts"]["manual"]["failed"] == 1
    empty_version, _ = _create_version_group(client, project["id"], "EVT3", "未执行")
    assert client.get(
        f"/api/projects/{project['id']}/trends", params={"product_version_id": empty_version["id"]}
    ).json()["status"] == "filtered_empty"


def test_project_comparison_requires_explicit_matching_scope_and_reports_changes(client, tmp_path):
    project = client.post(
        "/api/projects", json={"name": "Nova", "product_name": "Sensor", "description": ""}
    ).json()
    left_version, left_group = _create_version_group(client, project["id"], "EVT1", "基线")
    right_version, right_group = _create_version_group(client, project["id"], "EVT2", "回归")
    left_report = _insert_final_report(
        tmp_path,
        group_id=left_group["id"],
        version_id=left_version["id"],
        created_at="2026-10-01T00:00:00+00:00",
        modules=[
            _module("采集", _record("SRC-001", "自动化", "passed")),
            _module("旧模块", _record("SRC-003", "人工", "blocked")),
        ],
    )
    right_report = _insert_final_report(
        tmp_path,
        group_id=right_group["id"],
        version_id=right_version["id"],
        created_at="2026-10-02T00:00:00+00:00",
        modules=[
            _module("采集", _record("SRC-001", "自动化", "failed")),
            _module("新模块", _record("SRC-002", "人工", "passed")),
            _module("已改名模块", _record("SRC-003", "人工", "blocked")),
        ],
    )

    assert client.post(f"/api/projects/{project['id']}/report-comparisons", json={}).status_code == 422
    assert (
        client.post(
            f"/api/projects/{project['id']}/report-comparisons",
            json={
                "left_product_version_id": left_version["id"],
                "right_product_version_id": right_version["id"],
                "right_report_id": right_report,
            },
        ).status_code
        == 422
    )
    comparison = client.post(
        f"/api/projects/{project['id']}/report-comparisons",
        json={"left_product_version_id": left_version["id"], "right_product_version_id": right_version["id"]},
    )

    assert comparison.status_code == 200
    body = comparison.json()
    assert body["left"]["report_ids"] == [left_report]
    assert body["right"]["report_ids"] == [right_report]
    assert body["modules"][0]["name"] == "采集"
    assert body["modules"][0]["left"]["automation"]["passed"] == 1
    assert body["modules"][0]["right"]["automation"]["failed"] == 1
    assert body["added_modules"] == ["已改名模块", "新模块"]
    assert body["removed_modules"] == ["旧模块"]
    assert [item["case_number"] for item in body["added_scope"]] == ["SRC-002", "SRC-003"]
    assert [item["case_number"] for item in body["removed_scope"]] == ["SRC-003"]
    assert body["unaligned_scope"] == [
        {"case_number": "SRC-003", "left_modules": ["旧模块"], "right_modules": ["已改名模块"]}
    ]

    report_comparison = client.post(
        f"/api/projects/{project['id']}/report-comparisons",
        json={"left_report_id": left_report, "right_report_id": right_report},
    )
    assert report_comparison.status_code == 200
    assert report_comparison.json()["left"]["kind"] == "report"


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
