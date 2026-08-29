import csv
import io
import json
import time
import zipfile

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


def _create_aligned_run(client: TestClient, sample_rate_hz: int) -> dict:
    task = client.post(
        "/api/collection-tasks",
        json={
            "name": f"逐帧映射 {sample_rate_hz}Hz",
            "mode": "custom",
            "scenario": "fixed_offset",
            "duration_seconds": 2,
            "video": {"channels": 2, "resolution": "640x360", "fps": 15, "container": "mp4"},
            "imu": {"format": "csv", "sample_rate_hz": sample_rate_hz},
            "random_seed": 42,
        },
    ).json()
    queued = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
    return _wait_for_completion(client, queued["id"])


def test_frame_imu_alignment_is_an_independent_nearest_neighbor_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        run = _create_aligned_run(client, 50)
        alignment = run["alignment_result"]
        mapping_artifact = next(item for item in run["artifacts"] if item["kind"] == "frame_imu_alignment")
        mapping_response = client.get(f"/api/runs/{run['id']}/frame-imu-alignment.csv")
        report = client.get(f"/api/runs/{run['id']}/report").json()
        evidence_response = client.get(f"/api/runs/{run['id']}/evidence.zip")

    assert mapping_response.status_code == 200
    assert mapping_response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(mapping_response.content.decode("utf-8-sig"))))
    assert len(rows) == 60
    assert {row["video_channel"] for row in rows} == {"camera_1", "camera_2"}
    assert rows[0]["video_frame_number"] == "0"
    assert rows[0]["imu_sample_index"] != ""
    assert rows[0]["video_raw_device_timestamp_ns"] != ""
    assert rows[0]["imu_raw_device_timestamp_ns"] != ""
    assert rows[0]["video_relative_timestamp_s"] != ""
    assert rows[0]["imu_relative_timestamp_s"] != ""
    assert rows[0]["video_aligned_timestamp_s"] != ""
    assert rows[0]["imu_aligned_timestamp_s"] != ""
    assert float(rows[0]["time_difference_s"]) <= float(rows[0]["tolerance_s"])
    assert rows[0]["match_status"] == "matched"

    summary = alignment["frame_imu_alignment"]
    assert summary["artifact_path"] == mapping_artifact["path"]
    assert summary["frame_count"] == 60
    assert summary["unmatched_count"] >= 1
    assert mapping_artifact["path"] in json.dumps(report, ensure_ascii=False)

    with zipfile.ZipFile(io.BytesIO(evidence_response.content)) as archive:
        assert "frame-imu-alignment.csv" in archive.namelist()
        assert mapping_artifact["path"] in archive.read("report.json").decode("utf-8")


def test_frame_imu_alignment_summary_preserves_raw_times_and_exposes_unmatched_contract(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        run = _create_aligned_run(client, 100)
        alignment = run["alignment_result"]
        imu_artifact = next(item for item in run["artifacts"] if item["kind"] == "imu")
        video_artifact = next(item for item in run["artifacts"] if item["kind"] == "video")

    assert alignment["frame_imu_alignment"]["imu_sample_rate_hz"] == 100
    assert alignment["frame_imu_alignment"]["tolerance_s"] == 0.005
    assert (tmp_path / imu_artifact["path"]).is_file()
    assert (tmp_path / video_artifact["path"]).is_file()
    assert alignment["frame_imu_alignment"]["matched_count"] > 0
    assert alignment["frame_imu_alignment"]["unmatched_count"] >= 1
