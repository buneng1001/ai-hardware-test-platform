import time

from fastapi.testclient import TestClient

from app.main import app


def _wait_for_completion(client: TestClient, run_id: int) -> dict:
    """通过公开详情接口等待后台运行完成。"""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 10 秒内完成")


def test_storage_exhaustion_quick_scenario_is_repeatable_and_truth_matched(tmp_path, monkeypatch):
    """存储不足场景真实提前停止，三次确定性检查均命中故障真值。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "存储不足快速场景", "mode": "quick", "scenario": "storage_exhaustion"},
        ).json()
        first = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        second = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    storage_checks = {check["name"]: check for check in first["checks"] if check["category"] == "storage"}
    assert set(storage_checks) == {
        "storage_premature_stop",
        "storage_exhaustion",
        "storage_log_correlation",
    }
    assert all(check["status"] == "failed" for check in storage_checks.values())
    assert all(check["truth_comparison"] == "matched" for check in storage_checks.values())
    assert storage_checks["storage_premature_stop"]["metrics"]["actual_duration_s"] == 1
    assert storage_checks["storage_premature_stop"]["metrics"]["requested_duration_s"] == 2
    assert storage_checks["storage_exhaustion"]["metrics"]["minimum_free_mb"] < 500
    assert storage_checks["storage_log_correlation"]["metrics"]["matched_event_count"] >= 1

    first_truth = next(artifact for artifact in first["artifacts"] if artifact["kind"] == "fault_truth")
    second_truth = next(artifact for artifact in second["artifacts"] if artifact["kind"] == "fault_truth")
    assert first_truth["sha256"] == second_truth["sha256"]


def test_normal_scenario_does_not_report_storage_faults(tmp_path, monkeypatch):
    """正常场景不应误报存储相关检查。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "正常场景无存储故障", "mode": "quick", "scenario": "normal"},
        ).json()
        run = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    storage_checks = [check for check in run["checks"] if check["category"] == "storage"]
    assert len(storage_checks) == 3
    assert all(check["status"] == "passed" for check in storage_checks)
    assert all(check["truth_comparison"] == "not_applicable" for check in storage_checks)
