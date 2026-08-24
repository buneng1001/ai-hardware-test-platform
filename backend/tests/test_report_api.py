import time

from fastapi.testclient import TestClient

from app.main import app


def wait_for_completion(client: TestClient, run_id: int) -> dict:
    """通过公开详情接口等待后台运行完成。"""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in {"completed", "failed", "cancelled", "interrupted"}:
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 10 秒内结束")


def test_report_api_unifies_run_facts_and_keeps_optional_sections_explicit(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "报告正常场景", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

        response = client.get(f"/api/runs/{run['id']}/report")
        html_response = client.get(f"/api/runs/{run['id']}/report.html")

    assert response.status_code == 200
    report = response.json()
    assert report["run_id"] == run["id"]
    assert report["status"] == "completed"
    assert report["configuration_snapshot"] == run["configuration_snapshot"]
    assert [event["stage"] for event in report["stage_events"]] == [
        "queued",
        "generating_data",
        "running_checks",
        "summarizing_results",
        "completed",
    ]
    assert report["artifacts"] == run["artifacts"]
    assert report["automated_checks"] == run["checks"]
    assert report["fault_truth"]["scenario"] == "normal"
    assert "faults" in report["fault_truth"]
    assert report["manual_check_results"] == []
    assert report["alignment_result"] is None
    assert report["evaluation_result"] == run["evaluation_result"]
    assert report["diagnosis"] == {"status": "not_generated", "message": "诊断尚未生成"}
    assert html_response.status_code == 200
    assert html_response.headers["content-type"].startswith("text/html")
    assert "报告正常场景" not in html_response.text
    assert f"运行 #{run['id']}" in html_response.text
    assert "故障真值" in html_response.text
    assert "人工检查结果" in html_response.text


def test_report_api_handles_failed_run_and_unknown_run(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "报告异常场景", "mode": "quick", "scenario": "storage_exhaustion"},
        ).json()
        queued = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        run = client.post(f"/api/runs/{queued['id']}/cancel").json()
        report_response = client.get(f"/api/runs/{run['id']}/report")
        unknown_response = client.get("/api/runs/999999/report")

    assert run["status"] == "cancelled"
    report = report_response.json()
    assert report["status"] == "cancelled"
    assert report["automated_checks"] == []
    assert report["diagnosis"]["status"] == "not_generated"
    assert unknown_response.status_code == 404


def test_report_api_includes_manual_results_without_merging_them_into_automation(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "报告人工结果", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        manual = client.post(
            f"/api/runs/{run['id']}/manual-check-results",
            json={"name": "外观检查", "status": "blocked", "actual_result": "无法观察", "notes": "待补证据"},
        ).json()
        report = client.get(f"/api/runs/{run['id']}/report").json()

    assert report["automated_checks"] == run["checks"]
    assert report["manual_check_results"] == [manual]
