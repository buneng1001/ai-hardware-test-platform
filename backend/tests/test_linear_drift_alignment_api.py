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


def test_alignment_review_changes_analysis_without_overwriting_raw_artifacts(tmp_path, monkeypatch):
    """公开复核接口应保留自动结果的锚点引用和原始产物哈希。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    command = {
        "name": "锚点复核",
        "mode": "custom",
        "scenario": "linear_drift",
        "duration_seconds": 5,
        "video": {"channels": 4, "resolution": "640x360", "fps": 30, "container": "mp4"},
        "imu": {"format": "csv", "sample_rate_hz": 100},
        "random_seed": 42,
    }

    with TestClient(app) as client:
        task = client.post("/api/collection-tasks", json=command).json()
        run = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        original_hashes = {artifact["path"]: artifact["sha256"] for artifact in run["artifacts"]}
        camera_anchor = next(
            anchor
            for anchor in run["alignment_result"]["anchor_details"]
            if anchor["channel"] == "camera_4"
        )
        response = client.post(
            f"/api/runs/{run['id']}/alignment-review",
            json={
                "anchors": [
                    {
                        "anchor_id": camera_anchor["id"],
                        "reviewed_time_s": camera_anchor["detected_time_s"] + 0.033,
                        "included": True,
                    }
                ]
            },
        )
        assert response.status_code == 200
        reviewed = response.json()

    alignment = reviewed["alignment_result"]
    updated_anchor = next(anchor for anchor in alignment["anchor_details"] if anchor["id"] == camera_anchor["id"])
    assert alignment["review_revision"] == 1
    assert updated_anchor["reviewed_time_s"] == pytest.approx(camera_anchor["detected_time_s"] + 0.033)
    assert alignment["parameters"]["camera_4"] != pytest.approx(-0.03, abs=0.004)
    assert alignment["content_sync"]["status"] == "passed"
    assert {artifact["path"]: artifact["sha256"] for artifact in reviewed["artifacts"]} == original_hashes


def test_alignment_review_rejects_excluding_too_many_common_anchors(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    command = {
        "name": "锚点降级",
        "mode": "custom",
        "scenario": "linear_drift",
        "duration_seconds": 5,
        "video": {"channels": 4, "resolution": "640x360", "fps": 30, "container": "mp4"},
        "imu": {"format": "csv", "sample_rate_hz": 100},
        "random_seed": 42,
    }
    with TestClient(app) as client:
        task = client.post("/api/collection-tasks", json=command).json()
        run = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        anchors = [
            anchor["id"]
            for anchor in run["alignment_result"]["anchor_details"]
            if anchor["channel"] == "camera_1"
        ]
        response = client.post(
            f"/api/runs/{run['id']}/alignment-review",
            json={"anchors": [{"anchor_id": anchor_id, "included": False} for anchor_id in anchors[:1]]},
        )
    assert response.status_code == 422
    assert "有效共同锚点不足" in response.text
