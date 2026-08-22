import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


def _wait_for_completion(client: TestClient, run_id: int) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 10 秒内完成")


@pytest.mark.parametrize("imu_format", ["csv", "jsonl"])
def test_imu_contract_is_repeatable_for_csv_and_jsonl(tmp_path, monkeypatch, imu_format):
    """两种公开格式应由同一确定性检查契约消费。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    command = {
        "name": f"{imu_format} IMU 异常",
        "mode": "custom",
        "scenario": "imu_anomaly",
        "duration_seconds": 2,
        "video": {"channels": 1, "resolution": "640x360", "fps": 15, "container": "mp4"},
        "imu": {"format": imu_format, "sample_rate_hz": 100},
        "random_seed": 42,
    }

    with TestClient(app) as client:
        task = client.post("/api/collection-tasks", json=command).json()
        first = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        second = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    first_imu = [check for check in first["checks"] if check["category"] == "imu"]
    second_imu = [check for check in second["checks"] if check["category"] == "imu"]
    first_imu_artifact = next(artifact for artifact in first["artifacts"] if artifact["kind"] == "imu")
    second_imu_artifact = next(artifact for artifact in second["artifacts"] if artifact["kind"] == "imu")
    first_truth = next(artifact for artifact in first["artifacts"] if artifact["kind"] == "fault_truth")
    second_truth = next(artifact for artifact in second["artifacts"] if artifact["kind"] == "fault_truth")
    assert first_imu == second_imu
    assert first_imu_artifact["sha256"] == second_imu_artifact["sha256"]
    assert first_truth["sha256"] == second_truth["sha256"]
    assert all(check["status"] == "failed" for check in first_imu if check["name"] != "imu_sample_rate")
    assert all(
        check["truth_comparison"] == "matched"
        for check in first_imu
        if check["name"] in {"imu_missing_samples", "imu_duplicate_samples", "imu_timestamp_rollback"}
    )


@pytest.mark.parametrize("imu_format", ["csv", "jsonl"])
def test_normal_imu_does_not_report_anomalies_for_either_format(tmp_path, monkeypatch, imu_format):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    command = {
        "name": f"{imu_format} 正常 IMU",
        "mode": "custom",
        "scenario": "normal",
        "duration_seconds": 2,
        "video": {"channels": 1, "resolution": "640x360", "fps": 15, "container": "mp4"},
        "imu": {"format": imu_format, "sample_rate_hz": 50},
        "random_seed": 42,
    }

    with TestClient(app) as client:
        task = client.post("/api/collection-tasks", json=command).json()
        run = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    imu_checks = [check for check in run["checks"] if check["category"] == "imu"]
    assert all(check["status"] == "passed" for check in imu_checks)
    assert all(check["truth_comparison"] == "not_applicable" for check in imu_checks)
