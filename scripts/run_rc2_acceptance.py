"""运行 RC2 的离线端到端验收，并将可复查证据写入被 Git 忽略的目录。"""

import argparse
import hashlib
import io
import json
import os
import time
import zipfile
from pathlib import Path


TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}


def wait_for_terminal(client, run_id: int) -> dict:
    """只通过公开运行详情接口等待后台运行结束。"""
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in TERMINAL_STATUSES:
            return run
        time.sleep(0.02)
    raise AssertionError(f"运行 #{run_id} 未在 30 秒内结束")


def make_import_zip(video_bytes: bytes) -> bytes:
    """构造不含用户数据的公开格式导入样例。"""
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


def assert_evidence_zip(content: bytes) -> dict[str, object]:
    """验证 ZIP 清单、哈希、BOM 和默认视频排除边界。"""
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read("evidence-manifest.json"))
        if names != set(manifest["files"]):
            raise AssertionError("证据 ZIP 文件清单与实际内容不一致")
        if any(name.lower().endswith((".mp4", ".mkv")) for name in names):
            raise AssertionError("证据 ZIP 默认包含原始视频")
        if not archive.read("checks.csv").startswith(b"\xef\xbb\xbf"):
            raise AssertionError("checks.csv 缺少 UTF-8 BOM")
        for item in manifest["hashed_files"]:
            actual = hashlib.sha256(archive.read(item["path"])).hexdigest()
            if actual != item["sha256"]:
                raise AssertionError(f"证据哈希不一致：{item['path']}")
        return {"files": sorted(names), "export_note": manifest["export_note"]}


def main() -> int:
    parser = argparse.ArgumentParser(description="运行 v0.1.0-rc.2 ticket 08 Mock 验收")
    parser.add_argument("--output", type=Path, default=Path("tmp/rc2-acceptance"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    os.environ["APP_DATA_DIR"] = str(args.output / "data")
    os.environ["AI_DIAGNOSIS_MODE"] = "mock"

    from fastapi.testclient import TestClient

    from app.main import app

    summary: dict[str, object] = {
        "version": "v0.1.0-rc.2",
        "ticket": "08",
        "scenarios": {},
    }
    with TestClient(app) as client:
        for scenario in ("normal", "video_drop", "imu_anomaly"):
            task = client.post(
                "/api/collection-tasks",
                json={"name": f"RC2-{scenario}", "mode": "quick", "scenario": scenario},
            ).json()
            run = wait_for_terminal(
                client,
                client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"],
            )
            if run["status"] != "completed":
                raise AssertionError(f"合成场景未完成：{scenario}")
            summary["scenarios"][scenario] = {
                "run_id": run["id"],
                "failed_checks": [
                    check["name"]
                    for check in run["checks"]
                    if check["status"] == "failed"
                ],
                "imu_sample_rate_hz": run["configuration_snapshot"]["imu"][
                    "sample_rate_hz"
                ],
            }

        custom = client.post(
            "/api/collection-tasks",
            json={
                "name": "RC2-custom-50hz",
                "mode": "custom",
                "scenario": "normal",
                "duration_seconds": 2,
                "video": {
                    "channels": 1,
                    "resolution": "640x360",
                    "fps": 15,
                    "container": "mp4",
                    "codec": "h264",
                    "bitrate_kbps": 2500,
                    "bitrate_mode": "cbr",
                },
                "imu": {"format": "csv", "sample_rate_hz": 50},
                "random_seed": 20260822,
            },
        )
        if custom.status_code != 201:
            raise AssertionError(f"自定义 50Hz 配置失败：{custom.text}")
        summary["custom_50hz"] = custom.json()["id"]

        seed_task = client.post(
            "/api/collection-tasks",
            json={
                "name": "RC2-import-video-seed",
                "mode": "quick",
                "scenario": "normal",
            },
        ).json()
        seed_run = wait_for_terminal(
            client,
            client.post(f"/api/collection-tasks/{seed_task['id']}/runs").json()["id"],
        )
        video = next(item for item in seed_run["artifacts"] if item["kind"] == "video")
        upload = client.post(
            "/api/imports",
            data={"permission_confirmed": "true"},
            files={
                "file": (
                    "rc2-sample.zip",
                    make_import_zip(
                        (args.output / "data" / video["path"]).read_bytes()
                    ),
                    "application/zip",
                )
            },
        )
        if upload.status_code != 201:
            raise AssertionError(f"导入上传失败：{upload.text}")
        import_record = upload.json()
        validation = client.post(f"/api/imports/{import_record['id']}/validate")
        if validation.json()["status"] != "passed":
            raise AssertionError(f"导入校验失败：{validation.text}")
        imported_task = client.post(
            f"/api/imports/{import_record['id']}/create-task",
            json={"name": "RC2-imported", "label": "Mock 验收样例"},
        ).json()
        blocked = client.post(f"/api/collection-tasks/{imported_task['id']}/runs")
        if blocked.status_code != 422:
            raise AssertionError("导入任务未要求手工运行配置")
        queued = client.post(
            f"/api/collection-tasks/{imported_task['id']}/runs",
            json={
                "reference_channel": "camera_1",
                "evaluation": {
                    "mode": "baseline_analysis",
                    "threshold_source": "version_baseline",
                    "thresholds": {},
                },
            },
        )
        imported_run = wait_for_terminal(client, queued.json()["id"])
        report = client.get(f"/api/runs/{imported_run['id']}/report").json()
        evidence = client.get(f"/api/runs/{imported_run['id']}/evidence.zip")
        if report["fault_truth"] is not None or evidence.status_code != 200:
            raise AssertionError("导入运行的报告或证据边界不符合 RC2")
        summary["imported"] = {
            "run_id": imported_run["id"],
            "status": imported_run["status"],
            "fault_truth": None,
        }
        summary["evidence_zip"] = assert_evidence_zip(evidence.content)

        diagnosis = client.post(
            f"/api/runs/{summary['scenarios']['normal']['run_id']}/diagnoses",
            json={"mode": "mock"},
        )
        if diagnosis.status_code != 201 or not diagnosis.json()["is_mock"]:
            raise AssertionError(f"Mock 诊断失败：{diagnosis.text}")
        summary["diagnosis"] = {
            "status": diagnosis.json()["status"],
            "is_mock": diagnosis.json()["is_mock"],
        }

    summary_path = args.output / "acceptance-summary.json"
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    allure_dir = args.output / "allure-results"
    allure_dir.mkdir(exist_ok=True)
    (allure_dir / "rc2-ticket-08.json").write_text(
        json.dumps(
            {
                "name": "RC2 ticket 08 Mock 验收",
                "status": "passed",
                "attachments": [
                    {
                        "name": "acceptance-summary.json",
                        "source": "../acceptance-summary.json",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"RC2 ticket 08 Mock 验收通过，证据目录：{args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
