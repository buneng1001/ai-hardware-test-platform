import base64
from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app


def _create_completed_run(client: TestClient) -> dict:
    task = client.post(
        "/api/collection-tasks",
        json={"name": "人工检查运行", "mode": "quick", "scenario": "normal"},
    ).json()
    return client.post(f"/api/collection-tasks/{task['id']}/runs").json()


def test_engineer_can_add_manual_result_without_overwriting_automatic_checks(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        run = _create_completed_run(client)
        create_response = client.post(
            f"/api/runs/{run['id']}/manual-check-results",
            json={
                "name": "外壳无明显划痕",
                "status": "passed",
                "actual_result": "目视检查未见划痕",
                "notes": "自然光下检查",
                "executed_at": "2026-08-22T14:30:00+08:00",
            },
        )
        reopened_run = client.get(f"/api/runs/{run['id']}").json()

    assert create_response.status_code == 201
    manual_result = create_response.json()
    assert manual_result == {
        "id": manual_result["id"],
        "run_id": run["id"],
        "name": "外壳无明显划痕",
        "status": "passed",
        "actual_result": "目视检查未见划痕",
        "notes": "自然光下检查",
        "executed_at": "2026-08-22T14:30:00+08:00",
        "attachment": None,
        "created_at": manual_result["created_at"],
        "updated_at": manual_result["updated_at"],
    }
    assert reopened_run["checks"] == run["checks"]
    assert reopened_run["manual_check_results"] == [manual_result]


def test_engineer_can_modify_manual_result_and_attach_small_evidence(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        run = _create_completed_run(client)
        created = client.post(
            f"/api/runs/{run['id']}/manual-check-results",
            json={"name": "指示灯状态", "status": "not_run"},
        ).json()
        update_response = client.put(
            f"/api/runs/{run['id']}/manual-check-results/{created['id']}",
            json={
                "name": "指示灯状态",
                "status": "failed",
                "actual_result": "红灯持续闪烁",
                "notes": "建议复测供电",
                "executed_at": "2026-08-22T15:00:00Z",
                "attachment": {
                    "filename": "indicator.txt",
                    "content_type": "text/plain",
                    "content_base64": base64.b64encode("红灯持续闪烁".encode()).decode(),
                },
            },
        )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["status"] == "failed"
    assert updated["actual_result"] == "红灯持续闪烁"
    assert updated["attachment"]["filename"] == "indicator.txt"
    assert updated["attachment"]["content_type"] == "text/plain"
    assert updated["attachment"]["size_bytes"] == 18
    assert "content_base64" not in updated["attachment"]

    with TestClient(app) as client:
        preserved_response = client.put(
            f"/api/runs/{run['id']}/manual-check-results/{created['id']}",
            json={"name": "指示灯状态", "status": "passed", "actual_result": "复测正常"},
        )

    assert preserved_response.json()["attachment"] == updated["attachment"]


def test_csv_import_reports_invalid_row_without_partial_write(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    valid_csv = (
        "name,status,actual_result,notes,executed_at\n"
        "摄像头外观,blocked,镜头有雾气,等待清洁,2026-08-22T15:55:00+08:00\n"
    ).encode()
    csv_content = (
        "name,status,actual_result,notes,executed_at\n"
        "按键响应,passed,响应正常,连续按压三次,2026-08-22T16:00:00+08:00\n"
        "扬声器,unknown,无声音,状态值故意无效,2026-08-22T16:05:00+08:00\n"
    ).encode()

    with TestClient(app) as client:
        run = _create_completed_run(client)
        valid_response = client.post(
            f"/api/runs/{run['id']}/manual-check-results/import?filename=manual-results.csv",
            content=valid_csv,
            headers={"Content-Type": "text/csv"},
        )
        import_response = client.post(
            f"/api/runs/{run['id']}/manual-check-results/import?filename=manual-results.csv",
            content=csv_content,
            headers={"Content-Type": "text/csv"},
        )
        reopened_run = client.get(f"/api/runs/{run['id']}").json()

    assert valid_response.status_code == 201
    assert [result["status"] for result in valid_response.json()] == ["blocked"]
    assert import_response.status_code == 422
    assert import_response.json()["detail"] == [
        {"row": 3, "field": "status", "message": "状态必须是 passed、failed、blocked 或 not_run"}
    ]
    assert [result["name"] for result in reopened_run["manual_check_results"]] == ["摄像头外观"]


def test_excel_template_imports_valid_manual_results(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["name", "status", "actual_result", "notes", "executed_at"])
    sheet.append(["接口松动", "failed", "轻触时断开", "已拍照", "2026-08-22T16:30:00+08:00"])
    sheet.append(["标签核对", "not_run", "", "样机暂无标签", ""])
    excel_file = BytesIO()
    workbook.save(excel_file)

    with TestClient(app) as client:
        run = _create_completed_run(client)
        import_response = client.post(
            f"/api/runs/{run['id']}/manual-check-results/import?filename=manual-results.xlsx",
            content=excel_file.getvalue(),
            headers={"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        )

    assert import_response.status_code == 201
    assert [(result["name"], result["status"]) for result in import_response.json()] == [
        ("接口松动", "failed"),
        ("标签核对", "not_run"),
    ]
