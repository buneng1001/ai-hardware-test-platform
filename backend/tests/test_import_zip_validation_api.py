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
    raise AssertionError("导入型运行未在 10 秒内结束")


def _zip_bytes(*, include_optional: bool = False, include_fault_truth: bool = False) -> bytes:
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
        "sample_index,raw_device_timestamp_ns,relative_timestamp_s,accel_x_m_s2,accel_y_m_s2,accel_z_m_s2,gyro_x_rad_s,gyro_y_rad_s,gyro_z_rad_s",
        "0,1000000000,0.000000,0.0,0.0,9.8,0.0,0.0,0.0",
        "1,1010000000,0.010000,0.1,0.0,9.8,0.0,0.1,0.0",
    ]
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("videos/camera_1.mp4", b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2")
        archive.writestr("imu.csv", "\n".join(rows))
        if include_optional:
            archive.writestr("device-status.json", "{}")
            archive.writestr("device.log", "ready\n")
        if include_fault_truth:
            archive.writestr("fault_truth.json", "{}")
    return output.getvalue()


def _upload(client: TestClient, content: bytes):
    return client.post(
        "/api/imports",
        data={"permission_confirmed": "true"},
        files={"file": ("actual-test.zip", content, "application/zip")},
    )


def test_engineer_can_validate_actual_zip_and_add_unexecuted_imported_task(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        upload = _upload(client, _zip_bytes())
        assert upload.status_code == 201, upload.text
        import_record = upload.json()
        assert import_record["status"] == "uploaded"
        assert import_record["sha256"]

        validation = client.post(f"/api/imports/{import_record['id']}/validate")
        assert validation.status_code == 200, validation.text
        result = validation.json()
        assert result["status"] == "passed"
        assert result["validation"]["security"]["status"] == "passed"
        assert result["validation"]["compatibility"]["status"] == "passed"
        assert result["validation"]["warnings"]
        assert any("设备状态" in warning for warning in result["validation"]["warnings"])

        created = client.post(
            f"/api/imports/{import_record['id']}/create-task",
            json={"name": "现场相机导入复核", "label": "现场复核"},
        )
        assert created.status_code == 201, created.text
        task = created.json()
        assert task["source"] == "imported_actual_data"
        assert task["label"] == "现场复核"
        assert task["status"] == "draft"
        assert result["validation"]["files"]
        assert (tmp_path / "imports" / import_record["sha256"]).is_dir()
        assert client.get("/api/collection-tasks/saved", params={"source": "imported_actual_data"}).json()["items"]


def test_import_rejects_fault_truth_and_duplicate_sha256_without_partial_task(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        first = _upload(client, _zip_bytes(include_optional=True))
        assert first.status_code == 201
        first_id = first.json()["id"]
        assert client.post(f"/api/imports/{first_id}/validate").json()["status"] == "passed"

        duplicate = _upload(client, _zip_bytes(include_optional=True))
        assert duplicate.status_code == 409
        assert duplicate.json()["detail"]["existing_import_id"] == first_id

        forged = _upload(client, _zip_bytes(include_fault_truth=True))
        assert forged.status_code == 201
        forged_result = client.post(f"/api/imports/{forged.json()['id']}/validate")
        assert forged_result.status_code == 422
        assert any("fault_truth.json" in error for error in forged_result.json()["detail"]["errors"])


def test_import_rejects_path_traversal_without_leaving_formal_data(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("../escape.txt", "blocked")

    with TestClient(app) as client:
        upload = _upload(client, output.getvalue())
        assert upload.status_code == 201
        validation = client.post(f"/api/imports/{upload.json()['id']}/validate")
        assert validation.status_code == 422
        assert any("路径穿越" in error for error in validation.json()["detail"]["errors"])
        assert not list((tmp_path / "imports").glob("[0-9a-f]" * 64))
        assert not list(tmp_path.rglob("escape.txt"))


def test_imported_task_requires_manual_run_configuration_and_uses_imported_evidence(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        uploaded = _upload(client, _zip_bytes(include_optional=True))
        import_record = uploaded.json()
        assert client.post(f"/api/imports/{import_record['id']}/validate").json()["status"] == "passed"
        task = client.post(
            f"/api/imports/{import_record['id']}/create-task",
            json={"name": "导入运行链路", "label": "现场数据"},
        ).json()

        before_run = client.get(f"/api/collection-tasks/{task['id']}").json()
        assert before_run["source"] == "imported_actual_data"
        assert client.get("/api/runs/1").status_code == 404
        assert client.post(f"/api/collection-tasks/{task['id']}/runs").status_code == 422

        queued = client.post(
            f"/api/collection-tasks/{task['id']}/runs",
            json={
                "reference_channel": "camera_1",
                "evaluation": {
                    "mode": "baseline_analysis",
                    "threshold_source": "version_baseline",
                    "thresholds": {},
                },
            },
        )
        assert queued.status_code == 201, queued.text
        run = _wait_for_terminal(client, queued.json()["id"])
        report = client.get(f"/api/runs/{run['id']}/report").json()

    assert run["status"] == "completed"
    assert run["configuration_snapshot"]["reference_channel"] == "camera_1"
    assert run["configuration_snapshot"]["evaluation"]["mode"] == "baseline_analysis"
    assert {artifact["source"] for artifact in run["artifacts"]} == {"imported_actual_data"}
    assert not any(artifact["kind"] == "fault_truth" for artifact in run["artifacts"])
    assert run["evaluation_result"]["conclusion"] == "not_applicable"
    assert report["fault_truth"] is None
    assert {check["name"] for check in run["checks"]} >= {
        "video_channel_count",
        "video_bitrate",
        "imu_sample_rate",
    }
    assert all(check["truth_comparison"] == "not_applicable" for check in run["checks"])


def test_imported_task_marks_missing_optional_evidence_not_run_and_preserves_source(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        uploaded = _upload(client, _zip_bytes())
        import_record = uploaded.json()
        assert client.post(f"/api/imports/{import_record['id']}/validate").json()["status"] == "passed"
        task = client.post(
            f"/api/imports/{import_record['id']}/create-task",
            json={"name": "缺少可选证据", "label": "现场数据"},
        ).json()
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
        run = _wait_for_terminal(client, queued.json()["id"])
        original_imu = next(artifact for artifact in run["artifacts"] if artifact["kind"] == "imu")
        original_hash = original_imu["sha256"]

    assert run["status"] == "completed"
    checks = {check["name"]: check for check in run["checks"]}
    assert checks["storage_premature_stop"]["status"] == "not_run"
    assert checks["storage_exhaustion"]["status"] == "not_run"
    assert checks["storage_log_correlation"]["status"] == "not_run"
    assert original_imu["sha256"] == original_hash
    assert all(check["truth_comparison"] == "not_applicable" for check in run["checks"])
