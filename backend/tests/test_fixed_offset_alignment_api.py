import json
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


def _wait_for_completion(client: TestClient, run_id: int) -> dict:
    """通过公开详情接口等待后台运行完成。"""
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 15 秒内完成")


def test_fixed_offset_scenario_estimates_known_offsets_relative_to_camera_1(tmp_path, monkeypatch):
    """API 主 seam 应返回与故障真值一致的固定偏移估计和对齐残差。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    command = {
        "name": "固定偏移四路对齐",
        "mode": "custom",
        "scenario": "fixed_offset",
        "duration_seconds": 2,
        "video": {"channels": 4, "resolution": "640x360", "fps": 15, "container": "mp4"},
        "imu": {"format": "csv", "sample_rate_hz": 100},
        "random_seed": 42,
    }

    with TestClient(app) as client:
        task = client.post("/api/collection-tasks", json=command).json()
        run = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    assert run["configuration_snapshot"]["reference_channel"] == "camera_1"
    alignment = run["alignment_result"]
    assert alignment is not None
    assert alignment["reference_channel"] == "camera_1"
    assert alignment["method"] == "fixed_offset_anchor"

    truth_artifact = next(artifact for artifact in run["artifacts"] if artifact["kind"] == "fault_truth")
    truth_path = tmp_path / truth_artifact["path"]
    expected_offsets = json.loads(truth_path.read_text(encoding="utf-8"))["alignment_corrections_s"]
    estimated = alignment["parameters"]
    for channel, expected in expected_offsets.items():
        assert estimated[channel] == pytest.approx(expected, abs=0.001)

    # 视频通道对齐后残差应接近 0；IMU 因注入抖动残差大于 0 但可控
    for channel in ("camera_1", "camera_2", "camera_3", "camera_4"):
        post = alignment["post_alignment"][channel]
        assert post["max_residual_ms"] < 1.0

    imu_post = alignment["post_alignment"]["imu"]
    assert imu_post["max_residual_ms"] > 0.0
    assert imu_post["max_residual_ms"] < 5.0

    assert alignment["truth_comparison"] == "matched"


def test_engineer_can_select_alternative_reference_channel(tmp_path, monkeypatch):
    """参考通道可切换，偏移估计以所选通道为原点重新计算。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    command = {
        "name": "以 camera_3 为参考",
        "mode": "custom",
        "scenario": "fixed_offset",
        "duration_seconds": 2,
        "video": {"channels": 3, "resolution": "640x360", "fps": 15, "container": "mp4"},
        "imu": {"format": "csv", "sample_rate_hz": 100},
        "random_seed": 7,
        "reference_channel": "camera_3",
    }

    with TestClient(app) as client:
        task = client.post("/api/collection-tasks", json=command).json()
        run = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    alignment = run["alignment_result"]
    assert alignment["reference_channel"] == "camera_3"
    assert alignment["parameters"]["camera_3"] == pytest.approx(0.0, abs=0.001)
    # camera_3 比 camera_1 晚 2 帧；对齐 camera_1 到 camera_3 需加上 2/15 秒
    assert alignment["parameters"]["camera_1"] == pytest.approx(2 / 15, abs=0.001)
    assert alignment["truth_comparison"] == "matched"


def test_reference_channel_must_exist_in_the_configured_video_channels(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    response = TestClient(app).post(
        "/api/collection-tasks",
        json={
            "name": "不存在的参考通道",
            "mode": "custom",
            "scenario": "fixed_offset",
            "duration_seconds": 2,
            "video": {"channels": 1, "resolution": "640x360", "fps": 15, "container": "mp4"},
            "imu": {"format": "csv", "sample_rate_hz": 50},
            "random_seed": 7,
            "reference_channel": "camera_3",
        },
    )

    assert response.status_code == 422
    assert "不在当前视频通道范围内" in response.text


def test_non_fixed_offset_scenarios_have_no_alignment_result(tmp_path, monkeypatch):
    """非固定偏移场景不生成对齐结果，避免误把未实现能力标为已对齐。"""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "正常无对齐", "mode": "quick", "scenario": "normal"},
        ).json()
        run = _wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    assert run["alignment_result"] is None
