import io
import json
import zipfile

from fastapi.testclient import TestClient

from app.main import app


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
