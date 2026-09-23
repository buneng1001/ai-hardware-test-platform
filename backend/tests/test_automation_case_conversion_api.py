import pytest
from fastapi.testclient import TestClient

from app.database import open_database
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def create_version_with_source_cases(client: TestClient) -> int:
    project = client.post(
        "/api/projects",
        json={"name": "IRIS", "product_name": "Recorder", "description": ""},
    ).json()
    version_id = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()["id"]
    imported = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={
            "source_filename": "beta.csv",
            "field_mapping": {
                "case_number": "编号",
                "title": "标题",
                "input": "输入",
                "steps": "步骤",
                "expected_result": "预期",
            },
            "rows": [
                {
                    "编号": "REC-001",
                    "标题": "录制文件完整",
                    "输入": "正常录制数据",
                    "步骤": "开始录制并停止",
                    "预期": "生成完整视频文件",
                },
                {"编号": "REC-002", "标题": "断电恢复", "输入": "12V"},
            ],
            "import_options": {},
        },
    )
    assert imported.status_code == 201
    with open_database() as connection:
        connection.execute(
            """
            INSERT INTO source_test_cases
                (product_version_id, case_number, title, source_import_deleted, created_at)
            VALUES (?, ?, ?, 0, ?)
            """,
            (version_id, "REC-003", "", "2026-09-23T00:00:00+00:00"),
        )
    return version_id


def test_rule_conversion_keeps_sources_and_persists_low_confidence_candidates_per_row(client):
    version_id = create_version_with_source_cases(client)

    converted = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules")

    assert converted.status_code == 201
    assert converted.json()["created_count"] == 3
    assert [(item["source_case_number"], item["conversion_status"]) for item in converted.json()["items"]] == [
        ("REC-001", "candidate"),
        ("REC-002", "candidate"),
        ("REC-003", "failed"),
    ]
    first, second, failed = converted.json()["items"]
    assert first["case_number"].startswith("AUTO-")
    assert first["case_number"] != second["case_number"]
    assert first["input"] == "正常录制数据"
    assert first["steps"] == "开始录制并停止"
    assert first["expected_result"] == "生成完整视频文件"
    assert second["confidence"] == "low"
    assert "人工审核" in second["review_note"]
    assert failed["review_note"] == "缺少测试用例标题"

    source_cases = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
    assert [(item["case_number"], item["title"]) for item in source_cases] == [
        ("REC-001", "录制文件完整"),
        ("REC-002", "断电恢复"),
        ("REC-003", ""),
    ]

    listed = client.get(f"/api/product-versions/{version_id}/automation-test-cases")
    assert listed.status_code == 200
    assert listed.json()["items"] == converted.json()["items"]


def test_rule_conversion_is_idempotent_and_generated_numbers_are_not_reused_after_delete(client):
    version_id = create_version_with_source_cases(client)
    first_batch = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules").json()
    second_batch = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules")

    assert second_batch.status_code == 201
    assert second_batch.json()["created_count"] == 0
    assert second_batch.json()["items"] == first_batch["items"]
    with open_database() as connection:
        connection.execute("DELETE FROM automation_test_cases WHERE id = ?", (first_batch["items"][0]["id"],))
        connection.execute(
            """
            INSERT INTO source_test_cases
                (product_version_id, case_number, title, source_import_deleted, created_at)
            VALUES (?, ?, ?, 0, ?)
            """,
            (version_id, "REC-004", "新增用例", "2026-09-23T00:00:00+00:00"),
        )

    replacement = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules")

    assert replacement.status_code == 201
    assert replacement.json()["created_count"] == 2
    assert replacement.json()["items"][-1]["case_number"] not in {item["case_number"] for item in first_batch["items"]}
