import pytest
from fastapi.testclient import TestClient

from app.database import open_database
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def create_version_with_source_case(client: TestClient) -> int:
    project = client.post("/api/projects", json={"name": "IRIS", "product_name": "Recorder", "description": ""}).json()
    version_id = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()["id"]
    imported = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={
            "source_filename": "cases.csv",
            "field_mapping": {
                "case_number": "编号",
                "title": "标题",
                "steps": "步骤",
                "expected_result": "预期",
            },
            "rows": [
                {"编号": "REC-001", "标题": "录制", "步骤": "开始", "预期": "成功"},
                {"编号": "REC-002", "标题": "回放", "步骤": "播放", "预期": "成功"},
            ],
            "import_options": {},
        },
    )
    assert imported.status_code == 201
    return version_id


def test_engineer_can_create_edit_delete_validate_and_review_automation_case_history(client):
    version_id = create_version_with_source_case(client)
    converted = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules").json()
    case = converted["items"][0]
    assert case["validation_status"] == "unvalidated"

    edited = client.patch(
        f"/api/product-versions/{version_id}/automation-test-cases/{case['id']}",
        json={"title": "录制并检查", "input": "已连接设备", "steps": "开始并停止", "expected_result": "文件完整"},
    )
    assert edited.status_code == 200
    assert edited.json()["validation_status"] == "unvalidated"
    assert edited.json()["title"] == "录制并检查"

    created = client.post(
        f"/api/product-versions/{version_id}/automation-test-cases",
        json={
            "source_case_number": "REC-002",
            "title": "回放检查",
            "input": "",
            "steps": "播放",
            "expected_result": "成功",
        },
    )
    assert created.status_code == 201
    assert created.json()["case_number"].startswith("AUTO-")
    assert created.json()["validation_status"] == "unvalidated"

    validated = client.post(f"/api/product-versions/{version_id}/automation-test-cases/validate")
    assert validated.status_code == 200
    assert validated.json()["valid"] is True
    assert {item["validation_status"] for item in validated.json()["items"]} == {"passed"}

    regenerated = client.post(f"/api/product-versions/{version_id}/automation-test-cases/{case['id']}/regenerate")
    assert regenerated.status_code == 200
    assert regenerated.json()["validation_status"] == "unvalidated"

    history = client.get(f"/api/product-versions/{version_id}/automation-test-cases/{case['id']}/history")
    assert history.status_code == 200
    assert history.json()["source"]["case_number"] == "REC-001"
    assert [item["event_type"] for item in history.json()["items"]] == [
        "initial_conversion",
        "edited",
        "validated",
        "regenerated",
    ]

    deleted = client.delete(f"/api/product-versions/{version_id}/automation-test-cases/{created.json()['id']}")
    assert deleted.status_code == 204
    assert len(client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]) == 2
    deleted_history = client.get(
        f"/api/product-versions/{version_id}/automation-test-cases/{created.json()['id']}/history"
    )
    assert deleted_history.status_code == 200
    assert deleted_history.json()["source"]["case_number"] == "REC-002"
    with open_database() as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM automation_test_case_history WHERE automation_test_case_id = ?",
                (created.json()["id"],),
            ).fetchone()[0]
            >= 1
        )


def test_feedback_is_explicitly_unavailable_without_an_adapter_and_keeps_user_input(client):
    version_id = create_version_with_source_case(client)
    case = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules").json()["items"][0]

    feedback = client.post(
        f"/api/product-versions/{version_id}/automation-test-cases/{case['id']}/feedback",
        json={"feedback_input": "请把步骤改成命令行执行"},
    )

    assert feedback.status_code == 503
    assert feedback.json()["detail"] == "AI 反馈适配器不可用；已保留输入，请稍后重试或人工修改。"
    current = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"][0]
    assert current["feedback_input"] == "请把步骤改成命令行执行"
    assert current["feedback_status"] == "unavailable"
    history = client.get(f"/api/product-versions/{version_id}/automation-test-cases/{case['id']}/history").json()[
        "items"
    ]
    assert history[-1]["event_type"] == "feedback_unavailable"
