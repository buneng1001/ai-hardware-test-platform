import csv
import time

from fastapi.testclient import TestClient

from app.main import app


def _wait_for_completion(client: TestClient, run_id: int) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError("运行未在 10 秒内完成")


def test_quick_run_exposes_repeatable_six_axis_time_contract_and_bitrate(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    command = {"name": "RC2 六轴契约", "mode": "quick", "scenario": "normal"}

    with TestClient(app) as client:
        task = client.post("/api/collection-tasks", json=command).json()
        first = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        second = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    assert first["configuration_snapshot"]["imu"]["sample_rate_hz"] == 100
    assert first["configuration_snapshot"]["video"]["bitrate_kbps"] == 3000
    assert first["configuration_snapshot"]["video"]["bitrate_mode"] == "cbr"
    first_imu = next(item for item in first["artifacts"] if item["kind"] == "imu")
    second_imu = next(item for item in second["artifacts"] if item["kind"] == "imu")
    assert first_imu["sha256"] == second_imu["sha256"]

    rows = list(csv.DictReader((tmp_path / first_imu["path"]).open(encoding="utf-8", newline="")))
    assert list(rows[0]) == [
        "sample_index",
        "raw_device_timestamp_ns",
        "relative_timestamp_s",
        "accel_x",
        "accel_y",
        "accel_z",
        "gyro_x",
        "gyro_y",
        "gyro_z",
    ]
    assert rows[0]["raw_device_timestamp_ns"].isdigit()
    assert rows[0]["relative_timestamp_s"] == "0.000000"
    assert rows[1]["relative_timestamp_s"] == "0.010000"
    assert rows[0]["accel_z"] == "9.806650"
    assert rows[0]["gyro_x"] != ""

    timing_data = first["generation_metadata"]["time_contract"]
    assert timing_data["videos"]["camera_1"]["time_source"] == "container_pts"
    assert timing_data["videos"]["camera_1"]["start_raw_device_timestamp_ns"] > 0
    assert timing_data["videos"]["camera_1"]["relative_time_unit"] == "seconds"
