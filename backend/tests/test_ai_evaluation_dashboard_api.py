import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


def wait_for_completion(client: TestClient, run_id: int) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 10 秒内完成")


def create_run(client: TestClient, scenario: str) -> dict:
    task = client.post(
        "/api/collection-tasks",
        json={
            "name": f"评估-{scenario}",
            "mode": "quick",
            "scenario": scenario,
        },
    ).json()
    return wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])


def test_diagnosis_evaluation_separates_hits_misses_and_speculation(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        run = create_run(client, "video_drop")
        diagnosis = client.post(f"/api/runs/{run['id']}/diagnoses").json()
        dashboard = client.get("/api/dashboard").json()

    evaluation = diagnosis["evaluation"]
    assert evaluation["status"] == "evaluated"
    assert evaluation["structure_valid"] is True
    assert evaluation["hit_fault_types"] == ["video_frame_drop"]
    assert evaluation["missed_fault_types"] == []
    assert evaluation["hit_count"] == 1
    assert evaluation["missed_count"] == 0
    assert evaluation["unsupported_speculation_count"] == 0
    assert dashboard["evaluation_summary"]["evaluated_runs"] == 1
    assert dashboard["evaluation_summary"]["hit_count"] == 1


def test_normal_diagnosis_is_not_assigned_a_fault_and_empty_dashboard_is_safe(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        empty = client.get("/api/dashboard")
        run = create_run(client, "normal")
        diagnosis = client.post(f"/api/runs/{run['id']}/diagnoses").json()

    assert empty.status_code == 200
    assert empty.json()["run_statistics"]["total"] == 0
    evaluation = diagnosis["evaluation"]
    assert evaluation["expected_fault_types"] == []
    assert evaluation["hit_fault_types"] == []
    assert evaluation["missed_fault_types"] == []
    assert evaluation["diagnosed_fault_types"] == []
    assert evaluation["false_positive_count"] == 0


def test_failed_diagnosis_is_visible_without_changing_run_status(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        run = create_run(client, "storage_exhaustion")
        failed = client.post(
            f"/api/runs/{run['id']}/diagnoses",
            json={"mode": "siliconflow", "api_key": "missing"},
        ).json()
        dashboard = client.get("/api/dashboard").json()
        after = client.get(f"/api/runs/{run['id']}").json()

    assert failed["status"] == "failed"
    assert failed["evaluation"]["status"] == "not_evaluated"
    assert after["status"] == "completed"
    assert dashboard["diagnosis_status_counts"]["failed"] == 1
    assert dashboard["recent_failures"][0]["run_id"] == run["id"]


@pytest.mark.parametrize(
    "scenario",
    ["normal", "video_drop", "imu_anomaly", "storage_exhaustion", "temperature_combination", "linear_drift"],
)
def test_builtin_scenarios_produce_repeatable_evaluation_inputs(scenario, tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        run = create_run(client, scenario)
        first = client.post(f"/api/runs/{run['id']}/diagnoses").json()
        second = client.post(f"/api/runs/{run['id']}/diagnoses").json()

    assert first["evidence_package"] == second["evidence_package"]
    assert first["output"] == second["output"]
    assert first["evaluation"] == second["evaluation"]
    assert first["evaluation"]["status"] == "evaluated"
    expected_hits = {
        "normal": [],
        "video_drop": ["video_frame_drop"],
        "imu_anomaly": [
            "imu_missing_sample",
            "imu_duplicate_sample",
            "imu_timestamp_rollback",
        ],
        "storage_exhaustion": ["storage_exhaustion"],
        "temperature_combination": [
            "temperature_rise",
            "video_frame_drop",
            "imu_missing_sample",
        ],
        "linear_drift": [],
    }[scenario]
    assert first["evaluation"]["hit_fault_types"] == expected_hits
