import time

from fastapi.testclient import TestClient

from app.main import app


def wait_for_completion(client: TestClient, run_id: int) -> dict:
    """通过公开详情接口等待后台运行完成。"""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 10 秒内完成")


def test_engineer_can_run_normal_task_to_completion_without_overwriting_history(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "首个正常运行", "mode": "quick", "scenario": "normal"},
        ).json()

        first_queued = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        second_queued = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        first_run = wait_for_completion(client, first_queued["id"])
        second_run = wait_for_completion(client, second_queued["id"])
        reopened_first_run = client.get(f"/api/runs/{first_run['id']}").json()

    assert first_run["status"] == "completed"
    assert [event["stage"] for event in first_run["events"]] == [
        "queued",
        "generating_data",
        "running_checks",
        "summarizing_results",
        "completed",
    ]
    assert first_run["configuration_snapshot"] == {
        "mode": "quick",
        "scenario": "normal",
        "duration_seconds": 2,
        "video": {"channels": 1, "resolution": "640x360", "fps": 15, "container": "mp4", "codec": "h264"},
        "imu": {"format": "csv", "sample_rate_hz": 50},
        "random_seed": 20260822,
    }
    assert {artifact["kind"] for artifact in first_run["artifacts"]} == {
        "video",
        "imu",
        "device_status",
        "device_log",
        "fault_truth",
    }
    assert all(artifact["source"] == "actual_generated" for artifact in first_run["artifacts"])
    assert all(artifact["size_bytes"] > 0 for artifact in first_run["artifacts"])
    assert {check["name"] for check in first_run["checks"]} == {
        "required_artifacts",
        "video_h264",
        "normal_scenario",
    }
    assert all(check["status"] == "passed" for check in first_run["checks"])
    assert second_run["id"] != first_run["id"]
    assert reopened_first_run == first_run
