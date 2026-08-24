import json
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


def _wait_for_completion(client: TestClient, run_id: int) -> dict:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 20 秒内完成")


def test_linear_drift_alignment_estimates_multiple_event_model_and_improves_residuals(
    tmp_path, monkeypatch
):
    """API 主 seam 应用多个共同事件估计漂移，并保留完整前后结果。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    command = {
        "name": "线性漂移四路对齐",
        "mode": "custom",
        "scenario": "linear_drift",
        "duration_seconds": 5,
        "video": {"channels": 4, "resolution": "640x360", "fps": 30, "container": "mp4"},
        "imu": {"format": "csv", "sample_rate_hz": 100},
        "random_seed": 42,
    }

    with TestClient(app) as client:
        task_response = client.post("/api/collection-tasks", json=command)
        assert task_response.status_code == 201
        run_response = client.post(f"/api/collection-tasks/{task_response.json()['id']}/runs")
        run = _wait_for_completion(client, run_response.json()["id"])

    alignment = run["alignment_result"]
    assert alignment["method"] == "linear_drift_regression"
    assert len(alignment["anchors"]["camera_1"]) >= 3
    assert alignment["drift_rates_s_per_s"]["camera_4"] == pytest.approx(-0.03, abs=0.004)
    assert alignment["post_alignment"]["camera_4"]["max_residual_ms"] < 80
    assert alignment["post_alignment"]["camera_4"]["max_residual_ms"] < (
        alignment["pre_alignment"]["camera_4"]["max_residual_ms"]
    )
    assert alignment["truth_comparison"] == "matched"

    truth_artifact = next(artifact for artifact in run["artifacts"] if artifact["kind"] == "fault_truth")
    truth = json.loads((tmp_path / truth_artifact["path"]).read_text(encoding="utf-8"))
    assert truth["scenario"] == "linear_drift"
    assert truth["alignment_drift_rates_s_per_s"]["camera_4"] == pytest.approx(0.03)
