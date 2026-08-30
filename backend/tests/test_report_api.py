import base64
import hashlib
import io
import json
import time
import zipfile

from fastapi.testclient import TestClient

from app.main import app


def wait_for_completion(client: TestClient, run_id: int) -> dict:
    """通过公开详情接口等待后台运行完成。"""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in {"completed", "failed", "cancelled", "interrupted"}:
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 10 秒内结束")


def test_report_api_unifies_run_facts_and_keeps_optional_sections_explicit(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "报告正常场景", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])

        response = client.get(f"/api/runs/{run['id']}/report")
        html_response = client.get(f"/api/runs/{run['id']}/report.html")

    assert response.status_code == 200
    report = response.json()
    assert report["run_id"] == run["id"]
    assert report["status"] == "completed"
    assert report["configuration_snapshot"] == run["configuration_snapshot"]
    assert [event["stage"] for event in report["stage_events"]] == [
        "queued",
        "generating_data",
        "running_checks",
        "summarizing_results",
        "completed",
    ]
    assert report["artifacts"] == run["artifacts"]
    assert report["automated_checks"] == run["checks"]
    assert report["fault_truth"]["scenario"] == "normal"
    assert "faults" in report["fault_truth"]
    assert report["manual_check_results"] == []
    assert report["alignment_result"] is None
    assert report["evaluation_result"] == run["evaluation_result"]
    assert report["diagnosis"] == {"status": "not_generated", "message": "诊断尚未生成"}
    assert html_response.status_code == 200
    assert html_response.headers["content-type"].startswith("text/html")
    assert "报告正常场景" not in html_response.text
    assert f"运行 #{run['id']}" in html_response.text
    assert "故障真值" in html_response.text
    assert "人工检查结果" in html_response.text


def test_report_api_handles_failed_run_and_unknown_run(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "报告异常场景", "mode": "quick", "scenario": "storage_exhaustion"},
        ).json()
        queued = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        run = client.post(f"/api/runs/{queued['id']}/cancel").json()
        report_response = client.get(f"/api/runs/{run['id']}/report")
        unknown_response = client.get("/api/runs/999999/report")

    assert run["status"] == "cancelled"
    report = report_response.json()
    assert report["status"] == "cancelled"
    assert report["automated_checks"] == []
    assert report["diagnosis"]["status"] == "not_generated"
    assert unknown_response.status_code == 404


def test_report_api_includes_manual_results_without_merging_them_into_automation(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "报告人工结果", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        manual = client.post(
            f"/api/runs/{run['id']}/manual-check-results",
            json={"name": "外观检查", "status": "blocked", "actual_result": "无法观察", "notes": "待补证据"},
        ).json()
        report = client.get(f"/api/runs/{run['id']}/report").json()

    assert report["automated_checks"] == run["checks"]
    assert report["manual_check_results"] == [manual]


def test_evidence_zip_is_self_verifiable_and_excludes_video_by_default(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "可校验证据包", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        response = client.get(f"/api/runs/{run['id']}/evidence.zip")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read("evidence-manifest.json"))
        assert names == set(manifest["files"])
        assert {"report.json", "report.html", "checks.csv", "manual-check-results.csv"} <= names
        assert {"device_status.csv", "device.log", "fault_truth.json", "SHA256SUMS.txt"} <= names
        assert not any(name.endswith((".mp4", ".mkv")) for name in names)
        for entry in manifest["hashed_files"]:
            content = archive.read(entry["path"])
            assert entry["size_bytes"] == len(content)
            assert entry["sha256"] == hashlib.sha256(content).hexdigest()
        for line in archive.read("SHA256SUMS.txt").decode("utf-8").splitlines():
            digest, path = line.split("  ", maxsplit=1)
            assert digest == hashlib.sha256(archive.read(path)).hexdigest()
        assert "API_KEY" not in archive.read("report.json").decode("utf-8")


def test_evidence_zip_allows_only_explicit_small_video_sample(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "可选小样", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        response = client.get(f"/api/runs/{run['id']}/evidence.zip?include_sample=true")

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert any(name.startswith("thumbnails/") for name in archive.namelist())
        assert any(name.startswith("samples/") for name in archive.namelist())
        manifest = json.loads(archive.read("evidence-manifest.json"))
        assert manifest["excluded_kinds"] == ["video_original"]
        assert not any(name.startswith("runs/") for name in archive.namelist())


def test_evidence_zip_refuses_incomplete_run_without_creating_download(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "未完成证据", "mode": "quick", "scenario": "normal"},
        ).json()
        queued = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        client.post(f"/api/runs/{queued['id']}/cancel")
        response = client.get(f"/api/runs/{queued['id']}/evidence.zip")

    assert response.status_code == 409
    assert response.json()["detail"] == "只有已完成运行才能导出完整证据包"


def test_evidence_zip_failure_does_not_leave_a_partial_zip(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "导出失败清理", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        artifact = next(item for item in run["artifacts"] if item["kind"] == "device_log")
        (tmp_path / artifact["path"]).unlink()
        response = client.get(f"/api/runs/{run['id']}/evidence.zip")

    assert response.status_code == 500
    assert list(tmp_path.rglob("*.zip")) == []


def test_evidence_zip_redacts_sensitive_manual_text(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "敏感字段扫描", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        client.post(
            f"/api/runs/{run['id']}/manual-check-results",
            json={
                "name": "接口记录",
                "status": "blocked",
                "notes": "Authorization: Bearer secret-token API_KEY=sk-test-secret",
            },
        )
        response = client.get(f"/api/runs/{run['id']}/evidence.zip")

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        package_text = b"".join(archive.read(name) for name in archive.namelist() if not name.endswith(".mp4"))
    assert b"secret-token" not in package_text
    assert b"sk-test-secret" not in package_text
    assert b"[REDACTED]" in package_text


def test_raw_video_has_an_independent_download_and_evidence_export_metadata(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "原始视频下载", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        video = next(item for item in run["artifacts"] if item["kind"] == "video")
        video_response = client.get(f"/api/runs/{run['id']}/videos/camera_1")
        evidence_response = client.get(f"/api/runs/{run['id']}/evidence.zip")

    assert video_response.status_code == 200
    assert video_response.content == (tmp_path / video["path"]).read_bytes()
    assert video_response.headers["content-disposition"] == (
        f'attachment; filename="run-{run["id"]}-camera_1.mp4"'
    )
    assert evidence_response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(evidence_response.content)) as archive:
        manifest = json.loads(archive.read("evidence-manifest.json"))
        assert manifest["exported_at"]
        assert manifest["status"] == "completed"
        assert "按下载时当前状态生成" in manifest["export_note"]


def test_evidence_csv_is_excel_compatible_and_manual_results_can_be_reimported(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "人工结果回导", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        client.post(
            f"/api/runs/{run['id']}/manual-check-results",
            json={"name": "外观检查", "status": "blocked", "actual_result": "无法观察"},
        )
        response = client.get(f"/api/runs/{run['id']}/evidence.zip")

        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            manual_csv = archive.read("manual-check-results.csv")
            checks_csv = archive.read("checks.csv")
            imported = client.post(
                f"/api/runs/{run['id']}/manual-check-results/import?filename=manual-results.csv",
                content=manual_csv,
                headers={"Content-Type": "text/csv"},
            )

    assert manual_csv.startswith(b"\xef\xbb\xbf")
    assert checks_csv.startswith(b"\xef\xbb\xbf")
    assert imported.status_code == 201
    assert imported.json()[0]["name"] == "外观检查"


def test_evidence_zip_rejects_sensitive_binary_attachment(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "二进制敏感扫描", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        client.post(
            f"/api/runs/{run['id']}/manual-check-results",
            json={
                "name": "截图检查",
                "status": "blocked",
                "attachment": {
                    "filename": "evidence.png",
                    "content_type": "image/png",
                    "content_base64": base64.b64encode(b"API_KEY=embedded-secret").decode("ascii"),
                },
            },
        )
        response = client.get(f"/api/runs/{run['id']}/evidence.zip")

    assert response.status_code == 422
    assert "敏感字段" in response.json()["detail"]
