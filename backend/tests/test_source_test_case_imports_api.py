import io
import re
import zipfile

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.database import open_database
from app.main import app
from app.source_test_case_parsing import parse_source_case_file


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
            "case_type": "manual",
            "automation_test_case_id": None,
            "automation_validation_status": None,
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


def test_import_options_control_optional_fields_but_keep_input(client):
    version_id = create_version(client)
    field_mapping = {
        "case_number": "编号",
        "title": "标题",
        "input": "输入",
        "test_result": "结果",
        "test_record": "记录",
        "pre_test_notes": "备注",
        "planned_execution_time": "计划",
        "attachment": "附件",
    }
    row = {
        "编号": "REC-010",
        "标题": "历史字段导入",
        "输入": "12V",
        "结果": "通过",
        "记录": "已录屏",
        "备注": "测试前校准",
        "计划": "2026-10-30",
        "附件": "recording.mp4",
    }
    payload = {"source_filename": "beta.csv", "field_mapping": field_mapping, "rows": [row]}

    excluded = client.post(f"/api/product-versions/{version_id}/source-test-case-imports", json=payload)
    assert excluded.status_code == 201
    assert excluded.json()["import_options"] == {
        "include_historical_results": False,
        "include_test_records": False,
        "include_pre_test_notes": False,
        "include_planned_execution_time": False,
        "include_attachments": False,
    }
    excluded_case = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"][0]
    assert excluded_case["input"] == "12V"
    for optional_field in ("test_result", "test_record", "pre_test_notes", "planned_execution_time", "attachment"):
        assert excluded_case[optional_field] == ""

    included_payload = {
        **payload,
        "source_filename": "beta-all.csv",
        "import_options": {
            "include_historical_results": True,
            "include_test_records": True,
            "include_pre_test_notes": True,
            "include_planned_execution_time": True,
            "include_attachments": True,
        },
    }
    included = client.post(f"/api/product-versions/{version_id}/source-test-case-imports", json=included_payload)
    assert included.status_code == 201
    assert included.json()["import_options"]["include_attachments"] is True
    items = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
    imported_case = next(item for item in items if item["import_record_id"] == included.json()["id"])
    assert imported_case["test_result"] == "通过"
    assert imported_case["test_record"] == "已录屏"
    assert imported_case["pre_test_notes"] == "测试前校准"
    assert imported_case["planned_execution_time"] == "2026-10-30"
    assert imported_case["attachment"] == "recording.mp4"
    assert imported_case["input"] == "12V"


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
        "message": (
            "删除后会同时清除该导入记录下的原始用例，以及由这些用例生成的自动化候选和测试组关联；"
            "数据包和其他导入记录不受影响。"
        ),
    }
    assert client.delete(f"/api/source-test-case-imports/{record['id']}").status_code == 400
    assert client.delete(f"/api/source-test-case-imports/{record['id']}?confirm=true").status_code == 204
    # 删除导入记录会连带删除原始用例及其自动化候选。
    assert client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"] == []
    with open_database() as connection:
        assert connection.execute("SELECT COUNT(*) FROM automation_test_cases").fetchone()[0] == 0


def test_multi_row_case_is_merged_and_reimport_can_replace(client):
    """多行一条用例（编号只写在首行）要能导入；再次导入可覆盖旧用例表。"""
    project = client.post("/api/projects", json={"name": "IRIS", "product_name": "Recorder", "description": ""}).json()
    version_id = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()["id"]
    command = {
        "source_filename": "beta.csv",
        "field_mapping": {
            "case_number": "编号",
            "title": "标题",
            "steps": "步骤",
            "expected_result": "预期",
        },
        "rows": [
            {"编号": "TC-001", "标题": "登录", "步骤": "打开页面", "预期": "显示登录窗口"},
            {"编号": "", "标题": "", "步骤": "输入账号", "预期": "账号输入成功"},
            {"编号": "TC-002", "标题": "退出", "步骤": "点击退出", "预期": "回到登录页"},
        ],
        "import_options": {},
    }

    imported = client.post(f"/api/product-versions/{version_id}/source-test-case-imports", json=command)

    assert imported.status_code == 201
    cases = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
    assert [item["case_number"] for item in cases] == ["TC-001", "TC-002"]
    assert cases[0]["steps"] == "打开页面\n输入账号"
    assert cases[0]["expected_result"] == "显示登录窗口\n账号输入成功"

    replaced = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={**command, "replace_existing": True},
    )

    assert replaced.status_code == 201
    cases = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
    assert [item["case_number"] for item in cases] == ["TC-001", "TC-002"]
    records = client.get(f"/api/product-versions/{version_id}/source-test-case-imports").json()
    assert len(records) == 1


def _xlsx_with_broken_dimension() -> bytes:
    """模拟 WPS 这类把工作表范围写成 A1 的文件。"""
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["用例编号", "测试用例标题"])
    sheet.append(["TC-001", "录制检查"])
    sheet.append(["TC-002", "回放检查"])
    buffer = io.BytesIO()
    workbook.save(buffer)

    source = zipfile.ZipFile(io.BytesIO(buffer.getvalue()))
    patched = io.BytesIO()
    with zipfile.ZipFile(patched, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            data = source.read(item.filename)
            if item.filename.endswith("sheet1.xml"):
                data = re.sub(rb'<dimension ref="[^"]*"/>', b'<dimension ref="A1"/>', data)
            target.writestr(item, data)
    return patched.getvalue()


def test_xlsx_with_broken_dimension_still_reads_all_rows():
    """范围信息写坏时也要读到全部数据行，不能报“不包含数据行”。"""
    columns, rows = parse_source_case_file("broken.xlsx", _xlsx_with_broken_dimension())
    assert columns == ["用例编号", "测试用例标题"]
    assert [row["用例编号"] for row in rows] == ["TC-001", "TC-002"]
