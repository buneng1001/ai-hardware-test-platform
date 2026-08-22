import time

import pytest
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
    assert all(artifact["codec"] == "h264" for artifact in first_run["artifacts"] if artifact["kind"] == "video")
    assert all(artifact["size_bytes"] > 0 for artifact in first_run["artifacts"])
    assert {check["name"] for check in first_run["checks"]} == {
        "video_channel_count",
        "video_codec",
        "video_frame_rate",
        "video_duration",
        "video_frame_drop",
        "video_corruption",
    }
    assert all(check["status"] == "passed" for check in first_run["checks"])
    assert second_run["id"] != first_run["id"]
    assert reopened_first_run == first_run


def test_engineer_can_generate_repeatable_custom_multichannel_artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    configuration = {
        "name": "双路 JSONL 可重复生成",
        "mode": "custom",
        "scenario": "normal",
        "duration_seconds": 2,
        "video": {"channels": 2, "resolution": "640x360", "fps": 15, "container": "mkv"},
        "imu": {"format": "jsonl", "sample_rate_hz": 100},
        "random_seed": 42,
    }

    with TestClient(app) as client:
        task_response = client.post("/api/collection-tasks", json=configuration)
        assert task_response.status_code == 201
        task = task_response.json()

        first_queued = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        second_queued = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        first_run = wait_for_completion(client, first_queued["id"])
        second_run = wait_for_completion(client, second_queued["id"])

    expected_snapshot = {key: value for key, value in configuration.items() if key != "name"}
    expected_snapshot["video"] = configuration["video"] | {"codec": "h264"}
    assert first_run["configuration_snapshot"] == expected_snapshot
    assert [artifact["path"].split("/")[-1] for artifact in first_run["artifacts"]] == [
        "camera_1.mkv",
        "camera_2.mkv",
        "imu.jsonl",
        "device_status.csv",
        "device.log",
        "fault_truth.json",
    ]
    assert all(artifact["source"] == "actual_generated" for artifact in first_run["artifacts"])
    assert first_run["generation_metadata"]["timeline_source"] == "actual_generated"
    assert (
        first_run["generation_metadata"]["reproducibility_fingerprint"]
        == second_run["generation_metadata"]["reproducibility_fingerprint"]
    )
    assert [artifact["sha256"] for artifact in first_run["artifacts"]] == [
        artifact["sha256"] for artifact in second_run["artifacts"]
    ]


def test_long_run_uses_virtual_time_without_mislabeling_generated_media(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    configuration = {
        "name": "长稳虚拟时间",
        "mode": "custom",
        "scenario": "normal",
        "duration_seconds": 300,
        "video": {"channels": 1, "resolution": "640x360", "fps": 15, "container": "mp4"},
        "imu": {"format": "csv", "sample_rate_hz": 50},
        "random_seed": 7,
    }

    with TestClient(app) as client:
        task = client.post("/api/collection-tasks", json=configuration).json()
        queued = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        run = wait_for_completion(client, queued["id"])

    assert run["generation_metadata"] == {
        "timeline_source": "virtual_time_simulated",
        "requested_duration_seconds": 300,
        "generated_duration_seconds": 5,
        "reproducibility_fingerprint": run["generation_metadata"]["reproducibility_fingerprint"],
        "temperature_range_c": [40.0, 70.0],
        "storage_range_mb": [8192, 7592],
    }
    sources = {artifact["kind"]: artifact["source"] for artifact in run["artifacts"]}
    assert sources["video"] == "actual_generated"
    assert sources["imu"] == "actual_generated"
    assert sources["device_status"] == "virtual_time_simulated"


def test_oversized_custom_generation_is_rejected_before_a_run_is_created(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    oversized = {
        "name": "超大文件风险",
        "mode": "custom",
        "scenario": "normal",
        "duration_seconds": 300,
        "video": {"channels": 4, "resolution": "1920x1080", "fps": 60, "container": "mkv"},
        "imu": {"format": "jsonl", "sample_rate_hz": 500},
        "random_seed": 1,
    }

    with TestClient(app) as client:
        response = client.post("/api/collection-tasks", json=oversized)

    assert response.status_code == 422
    assert "预计文件规模超过安全上限" in response.text
    assert client.get("/api/collection-tasks").json() == []


@pytest.mark.parametrize(
    ("scenario", "expected_status", "expected_dropped_frames", "expected_truth_comparison"),
    [
        ("normal", "passed", 0, "not_applicable"),
        ("video_drop", "failed", 6, "matched"),
    ],
)
def test_engineer_sees_expected_video_drop_result_for_each_scenario(
    tmp_path,
    monkeypatch,
    scenario,
    expected_status,
    expected_dropped_frames,
    expected_truth_comparison,
):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task_response = client.post(
            "/api/collection-tasks",
            json={"name": "视频场景检查", "mode": "quick", "scenario": scenario},
        )
        assert task_response.status_code == 201
        queued = client.post(f"/api/collection-tasks/{task_response.json()['id']}/runs").json()
        run = wait_for_completion(client, queued["id"])

    drop_check = next(check for check in run["checks"] if check["name"] == "video_frame_drop")
    assert run["configuration_snapshot"]["scenario"] == scenario
    assert drop_check["status"] == expected_status
    assert drop_check["metrics"]["dropped_frames"] == expected_dropped_frames
    assert drop_check["truth_comparison"] == expected_truth_comparison
    if scenario == "video_drop":
        assert drop_check["message"] == "第 1 路视频在 0.800～1.200 秒检测到 6 帧缺失"
        assert drop_check["metrics"] == {
            "channel": 1,
            "expected_frames": 30,
            "actual_frames": 24,
            "dropped_frames": 6,
        }
        assert drop_check["anomaly_windows"] == [{"channel": 1, "start_s": 0.8, "end_s": 1.2}]
    assert {check["name"] for check in run["checks"]} == {
        "video_channel_count",
        "video_codec",
        "video_frame_rate",
        "video_duration",
        "video_frame_drop",
        "video_corruption",
    }


def test_same_seed_repeats_equivalent_video_drop_fault(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "重复掉帧", "mode": "quick", "scenario": "video_drop"},
        ).json()
        first = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        second = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

    first_drop = next(check for check in first["checks"] if check["name"] == "video_frame_drop")
    second_drop = next(check for check in second["checks"] if check["name"] == "video_frame_drop")
    first_truth = next(artifact for artifact in first["artifacts"] if artifact["kind"] == "fault_truth")
    second_truth = next(artifact for artifact in second["artifacts"] if artifact["kind"] == "fault_truth")
    assert first_drop == second_drop
    assert first_truth["sha256"] == second_truth["sha256"]
