import io

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.database import open_database
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def create_version(client: TestClient) -> int:
    project = client.post(
        "/api/projects",
        json={"name": "IRIS", "product_name": "Recorder", "description": ""},
    ).json()
    return client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()["id"]


def test_engineer_previews_confirms_and_filters_source_test_case_import(client):
    version_id = create_version(client)
    content = (
        "用例编号,测试用例标题,优先级,模块,测试项,输入,软件版本,测试结果\n"
        "REC-001,录制文件完整,高,录制,文件完整性,,1.2.0,通过\n"
        "REC-002,断电恢复,中,电源,恢复,12V,1.2.0,失败\n"
    ).encode()
    preview = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports/preview?filename=beta.csv",
        content=content,
    )

    assert preview.status_code == 200
    preview_body = preview.json()
    assert preview_body["field_mapping"]["case_number"] == "用例编号"
    assert preview_body["field_mapping"]["input"] == "输入"
    assert preview_body["rows"][0]["测试用例标题"] == "录制文件完整"

    imported = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={
            **preview_body,
            "import_options": {
                "include_historical_results": False,
                "include_test_records": False,
                "include_pre_test_notes": False,
                "include_planned_execution_time": False,
                "include_attachments": False,
            },
        },
    )
    assert imported.status_code == 201
    assert imported.json()["source_filename"] == "beta.csv"

    filtered = client.get(
        f"/api/product-versions/{version_id}/source-test-cases",
        params={"module": "录制", "priority": "高", "software_version": "1.2.0"},
    )
    assert filtered.status_code == 200
    assert filtered.json()["items"] == [
        {
            "id": 1,
            "import_record_id": imported.json()["id"],
            "source_import_status": "active",
            "case_number": "REC-001",
            "title": "录制文件完整",
            "priority": "高",
            "preconditions": "",
            "input": "",
            "steps": "",
            "expected_result": "",
            "test_type": "",
            "module": "录制",
            "test_item": "文件完整性",
            "test_result": "",
            "test_record": "",
            "pre_test_notes": "",
            "planned_execution_time": "",
            "attachment": "",
            "software_version": "1.2.0",
            "selected": False,
        }
    ]

    selected = client.put(
        f"/api/product-versions/{version_id}/source-test-case-selection",
        json={"source_test_case_ids": [1]},
    )
    assert selected.status_code == 200
    assert selected.json() == {"source_test_case_ids": [1]}
    assert client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"][0]["selected"] is True


def test_import_record_keeps_duplicate_file_history_but_rejects_duplicate_case_number_within_one_import(client):
    version_id = create_version(client)
    payload = {
        "source_filename": "beta.csv",
        "field_mapping": {"case_number": "编号", "title": "标题", "input": ""},
        "rows": [{"编号": "REC-001", "标题": "录制"}],
        "import_options": {},
    }
    first = client.post(f"/api/product-versions/{version_id}/source-test-case-imports", json=payload)
    second = client.post(f"/api/product-versions/{version_id}/source-test-case-imports", json=payload)
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] != second.json()["id"]

    duplicate = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={**payload, "rows": [payload["rows"][0], payload["rows"][0]]},
    )
    assert duplicate.status_code == 422
    assert "同一导入记录" in duplicate.json()["detail"][0]["msg"]


def test_xlsx_preview_and_import_record_deletion_explain_affected_source_cases(client):
    version_id = create_version(client)
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["用例编号", "测试用例标题", "输入"])
    worksheet.append(["REC-001", "录制", None])
    stream = io.BytesIO()
    workbook.save(stream)
    preview = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports/preview?filename=beta.xlsx",
        content=stream.getvalue(),
    ).json()
    record = client.post(f"/api/product-versions/{version_id}/source-test-case-imports", json=preview).json()
    with open_database() as connection:
        connection.execute(
            """
            INSERT INTO automation_test_cases
                (product_version_id, source_test_case_id, case_number, conversion_status,
                 confidence, review_note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (version_id, 1, "AUTO-000001", "candidate", "low", "需人工审核", "2026-09-23T00:00:00+00:00"),
        )

    impact = client.get(f"/api/source-test-case-imports/{record['id']}/deletion-impact")
    assert impact.status_code == 200
    assert impact.json() == {
        "import_record_id": record["id"],
        "source_test_cases": 1,
        "automation_test_cases": 1,
        "message": "删除后原始用例保留，但其来源会标记为“导入记录已删除”；已有自动化用例不会被删除。",
    }
    assert client.delete(f"/api/source-test-case-imports/{record['id']}").status_code == 400
    assert client.delete(f"/api/source-test-case-imports/{record['id']}?confirm=true").status_code == 204
    retained = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
    assert retained[0]["source_import_status"] == "import_deleted"
    assert retained[0]["import_record_id"] is None
    with open_database() as connection:
        assert connection.execute("SELECT COUNT(*) FROM automation_test_cases").fetchone()[0] == 1
