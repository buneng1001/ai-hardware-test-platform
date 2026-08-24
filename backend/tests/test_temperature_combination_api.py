import time

from fastapi.testclient import TestClient

from app.main import app


def _wait_for_completion(client: TestClient, run_id: int) -> dict:
    """通过公开运行详情接口等待组合场景完成。"""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 10 秒内完成")


def test_temperature_combination_links_facts_in_one_window_and_repeats(
    tmp_path, monkeypatch
):
    """公开 API 应展示同一窗口内的温升、掉帧、丢样和日志事实。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    command = {
        "name": "温升组合故障",
        "mode": "custom",
        "scenario": "temperature_combination",
        "duration_seconds": 2,
        "video": {"channels": 1, "resolution": "640x360", "fps": 15, "container": "mp4"},
        "imu": {"format": "csv", "sample_rate_hz": 50},
        "random_seed": 42,
    }

    with TestClient(app) as client:
        task = client.post("/api/collection-tasks", json=command).json()
        first = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        second = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    first_checks = {check["name"]: check for check in first["checks"]}
    second_checks = {check["name"]: check for check in second["checks"]}
    expected = {
        "video_frame_drop",
        "imu_missing_samples",
        "imu_interval_distribution",
        "temperature_rise",
        "temperature_window_correlation",
        "temperature_log_correlation",
    }
    assert expected <= first_checks.keys()
    assert all(first_checks[name]["status"] == "failed" for name in expected)
    assert all(first_checks[name]["truth_comparison"] == "matched" for name in expected)
    assert first_checks["video_frame_drop"]["anomaly_windows"] == [
        {"channel": 1, "start_s": 0.8, "end_s": 1.2}
    ]
    assert first_checks["temperature_window_correlation"]["anomaly_windows"] == [
        {"start_s": 0.8, "end_s": 1.2}
    ]
    assert first_checks["imu_missing_samples"]["anomaly_windows"][0]["start_s"] == 0.8
    assert first_checks["imu_missing_samples"]["anomaly_windows"][0]["end_s"] == 0.84
    assert first_checks["temperature_log_correlation"]["metrics"]["matched_event_count"] >= 2
    evidence_refs = first_checks["temperature_window_correlation"]["evidence_refs"]
    assert evidence_refs == [
        "fault_truth:temperature_combination",
        "device_status:temperature_window",
        "device_log:temperature_window",
    ]
    assert all(first_checks[name] == second_checks[name] for name in expected)
    first_truth = next(artifact for artifact in first["artifacts"] if artifact["kind"] == "fault_truth")
    second_truth = next(artifact for artifact in second["artifacts"] if artifact["kind"] == "fault_truth")
    assert first_truth["sha256"] == second_truth["sha256"]


def test_normal_scenario_has_no_temperature_combination_false_positive(tmp_path, monkeypatch):
    """正常场景不应增加组合故障资源和日志误报。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "正常无温升组合故障", "mode": "quick", "scenario": "normal"},
        ).json()
        run = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    assert not {
        "temperature_rise",
        "temperature_window_correlation",
        "temperature_log_correlation",
    } & {check["name"] for check in run["checks"]}
