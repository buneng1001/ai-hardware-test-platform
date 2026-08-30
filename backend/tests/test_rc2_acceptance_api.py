import hashlib
import io
import json
import time
import zipfile

from fastapi.testclient import TestClient

from app.main import app


def _wait_for_terminal(client: TestClient, run_id: int) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in {"completed", "failed", "cancelled", "interrupted"}:
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 10 秒内结束")


def _actual_zip(video_bytes: bytes = b"\x00\x00\x00\x18ftypisom") -> bytes:
    manifest = {
        "schema_version": "1.0",
        "time_source": "device_clock",
        "videos": [
            {
                "channel": "camera_1",
                "path": "videos/camera_1.mp4",
                "codec": "h264",
                "container": "mp4",
                "fps": 30,
                "resolution": "640x360",
                "bitrate_kbps": 2500,
                "start_raw_device_timestamp_ns": 1_000_000_000,
                "time_source": "container_pts",
            }
        ],
        "imu": {
            "path": "imu.csv",
            "format": "csv",
            "sample_rate_hz": 100,
            "time_source": "device_clock",
        },
    }
    rows = [
        "sample_index,raw_device_timestamp_ns,relative_timestamp_s,"
        "accel_x_m_s2,accel_y_m_s2,accel_z_m_s2,gyro_x_rad_s,gyro_y_rad_s,gyro_z_rad_s",
        "0,1000000000,0.000000,0.0,0.0,9.8,0.0,0.0,0.0",
        "1,1010000000,0.010000,0.1,0.0,9.8,0.0,0.1,0.0",
    ]
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("videos/camera_1.mp4", video_bytes)
        archive.writestr("imu.csv", "\n".join(rows))
    return output.getvalue()


def test_rc2_synthetic_acceptance_preserves_six_axis_and_mapping_evidence(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "mock")

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "RC2 验收正常场景", "mode": "quick", "scenario": "normal"},
        ).json()
        run = _wait_for_terminal(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        diagnosis = client.post(f"/api/runs/{run['id']}/diagnoses", json={"mode": "mock"})
        report = client.get(f"/api/runs/{run['id']}/report").json()

    assert run["status"] == "completed"
    assert run["configuration_snapshot"]["imu"]["sample_rate_hz"] == 100
    imu = next(artifact for artifact in run["artifacts"] if artifact["kind"] == "imu")
    imu_content = (tmp_path / "runs" / str(run["id"]) / "imu.csv").read_text(encoding="utf-8")
    assert {"accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z"} <= set(
        imu_content.splitlines()[0].split(",")
    )
    assert imu["sha256"] == hashlib.sha256(imu_content.encode()).hexdigest()
    with TestClient(app) as client:
        alignment_task = client.post(
            "/api/collection-tasks",
            json={"name": "RC2 验收对齐场景", "mode": "quick", "scenario": "fixed_offset"},
        ).json()
        alignment_run = _wait_for_terminal(
            client, client.post(f"/api/collection-tasks/{alignment_task['id']}/runs").json()["id"]
        )
    assert alignment_run["alignment_result"]["frame_imu_alignment"]["artifact_path"].endswith("frame-imu-alignment.csv")
    assert report["automated_checks"] == run["checks"]
    assert diagnosis.status_code == 201, diagnosis.text
    assert diagnosis.json()["is_mock"] is True


def test_rc2_import_acceptance_requires_manual_run_and_protects_evidence_zip(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        seed_task = client.post(
            "/api/collection-tasks",
            json={"name": "RC2 导入视频样本", "mode": "quick", "scenario": "normal"},
        ).json()
        seed_run = _wait_for_terminal(client, client.post(f"/api/collection-tasks/{seed_task['id']}/runs").json()["id"])
        video_artifact = next(artifact for artifact in seed_run["artifacts"] if artifact["kind"] == "video")
        video_bytes = (tmp_path / video_artifact["path"]).read_bytes()
        uploaded = client.post(
            "/api/imports",
            data={"permission_confirmed": "true"},
            files={"file": ("actual-test.zip", _actual_zip(video_bytes), "application/zip")},
        )
        assert uploaded.status_code == 201, uploaded.text
        imported = uploaded.json()
        validated = client.post(f"/api/imports/{imported['id']}/validate")
        assert validated.json()["status"] == "passed"
        task = client.post(
            f"/api/imports/{imported['id']}/create-task",
            json={"name": "RC2 导入验收", "label": "验收样例"},
        ).json()
        assert client.post(f"/api/collection-tasks/{task['id']}/runs").status_code == 422
        queued = client.post(
            f"/api/collection-tasks/{task['id']}/runs",
            json={
                "reference_channel": "camera_1",
                "evaluation": {
                    "mode": "requirements_acceptance",
                    "threshold_source": "formal_specification",
                    "thresholds": {"max_failed_checks": 0},
                },
            },
        )
        assert queued.status_code == 201, queued.text
        run = _wait_for_terminal(client, queued.json()["id"])
        report = client.get(f"/api/runs/{run['id']}/report").json()
        evidence = client.get(f"/api/runs/{run['id']}/evidence.zip")

    assert run["status"] == "completed"
    assert {artifact["source"] for artifact in run["artifacts"]} == {"imported_actual_data"}
    assert not any(artifact["kind"] == "fault_truth" for artifact in run["artifacts"])
    assert report["fault_truth"] is None
    assert evidence.status_code == 200, evidence.text
    with zipfile.ZipFile(io.BytesIO(evidence.content)) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read("evidence-manifest.json"))
        assert names == set(manifest["files"])
        assert not any(name.lower().endswith((".mp4", ".mkv")) for name in names)
        assert archive.read("checks.csv").startswith(b"\xef\xbb\xbf")
        for item in manifest["hashed_files"]:
            assert hashlib.sha256(archive.read(item["path"])).hexdigest() == item["sha256"]
