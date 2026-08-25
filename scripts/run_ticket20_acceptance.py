"""离线运行 Ticket 20 的 Mock 验收，并保存可复查的 JSON、HTML 和 ZIP 证据。"""

import argparse
import hashlib
import json
import os
import time
import zipfile
from pathlib import Path

def wait_for_completion(client, run_id: int) -> dict:
    """通过公开 API 轮询，避免验收脚本绕过运行管理 seam。"""
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in {"completed", "failed", "cancelled", "interrupted"}:
            return run
        time.sleep(0.02)
    raise RuntimeError(f"运行 #{run_id} 未在 30 秒内结束")
def custom_task(name: str, scenario: str, evaluation: dict | None = None) -> dict:
    return {
        "name": name,
        "mode": "custom",
        "scenario": scenario,
        "duration_seconds": 2,
        "video": {
            "channels": 1,
            "resolution": "640x360",
            "fps": 15,
            "container": "mp4",
        },
        "imu": {"format": "csv", "sample_rate_hz": 50},
        "random_seed": 20260822,
        "evaluation": evaluation or {},
    }
EXPECTED_FAULT_TYPES = {
    "normal": set(),
    "video_drop": {"video_frame_drop"},
    "imu_anomaly": {
        "imu_missing_sample",
        "imu_duplicate_sample",
        "imu_timestamp_rollback",
    },
    "storage_exhaustion": {"storage_exhaustion"},
    "temperature_combination": {
        "temperature_rise",
        "video_frame_drop",
        "imu_missing_sample",
    },
    "linear_drift": set(),
}
def assert_scenario_evidence(scenario: str, run: dict, evaluation: dict) -> None:
    """把场景真值、确定性检查和诊断评估连接成可失败的验收断言。"""
    expected = EXPECTED_FAULT_TYPES[scenario]
    diagnosed = set(evaluation["diagnosed_fault_types"])
    if set(evaluation["hit_fault_types"]) != expected:
        raise AssertionError(f"场景 {scenario} 的诊断命中不完整：{evaluation}")
    if set(evaluation["missed_fault_types"]):
        raise AssertionError(f"场景 {scenario} 存在漏判：{evaluation}")
    if scenario == "normal" and run["checks"]:
        failed = [item["name"] for item in run["checks"] if item["status"] == "failed"]
        if failed:
            raise AssertionError(f"正常场景误报：{failed}")
    if scenario not in {"normal", "linear_drift"} and not expected.issubset(diagnosed):
        raise AssertionError(f"场景 {scenario} 未诊断出全部真值：{diagnosed}")
def main() -> int:
    parser = argparse.ArgumentParser(description="运行 Ticket 20 Mock 验收")
    parser.add_argument("--output", type=Path, default=Path("tmp/ticket20-acceptance"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    os.environ["APP_DATA_DIR"] = str(args.output / "data")
    os.environ["AI_DIAGNOSIS_MODE"] = "mock"

    from fastapi.testclient import TestClient
    from app import diagnosis as diagnosis_module
    from app.main import app
    from app.siliconflow import ModelErrorKind, SiliconFlowError
    class OfflineFailingAdapter:
        """模拟模型不可用，证明诊断失败不会改变已完成运行。"""

        def generate(self, **_kwargs):
            raise SiliconFlowError(
                ModelErrorKind.AUTHENTICATION, "Mock 模型不可用", False
            )

    scenarios = [
        "normal",
        "video_drop",
        "imu_anomaly",
        "storage_exhaustion",
        "temperature_combination",
        "linear_drift",
    ]
    evidence: dict[str, object] = {
        "scenarios": {},
        "modes": {},
        "alignment": {},
        "security": {},
    }
    with TestClient(app) as client:
        for scenario in scenarios:
            task_response = client.post(
                "/api/collection-tasks",
                json={
                    "name": f"Ticket20-{scenario}",
                    "mode": "quick",
                    "scenario": scenario,
                },
            )
            task_response.raise_for_status()
            task = task_response.json()
            run_id = client.post(f"/api/collection-tasks/{task['id']}/runs").json()[
                "id"
            ]
            run = wait_for_completion(client, run_id)
            if run["status"] != "completed":
                raise RuntimeError(f"场景 {scenario} 未完成：{run}")
            diagnosis_response = client.post(f"/api/runs/{run_id}/diagnoses")
            if diagnosis_response.status_code != 201:
                raise RuntimeError(
                    f"场景 {scenario} Mock 诊断失败：{diagnosis_response.text}"
                )
            diagnosis_result = diagnosis_response.json()
            assert_scenario_evidence(scenario, run, diagnosis_result["evaluation"])
            evidence["scenarios"][scenario] = {
                "run_id": run_id,
                "status": run["status"],
                "artifact_count": len(run["artifacts"]),
                "failed_checks": [
                    item["name"] for item in run["checks"] if item["status"] == "failed"
                ],
                "diagnosis_evaluation": diagnosis_result["evaluation"],
            }
        mode_cases = {
            "requirements_acceptance": "formal_specification",
            "engineering_target": "engineering_target",
            "baseline_analysis": "version_baseline",
        }
        for mode, source in mode_cases.items():
            task = client.post(
                "/api/collection-tasks",
                json=custom_task(
                    f"Ticket20-{mode}",
                    "normal",
                    {
                        "mode": mode,
                        "threshold_source": source,
                        "thresholds": {"max_failed_checks": 0},
                    },
                ),
            ).json()
            evidence["modes"][mode] = {
                "task_id": task["id"],
                "threshold_source": task["evaluation"]["threshold_source"],
            }
        data_modes = {}
        for mode in ("quick", "standard", "custom"):
            payload = (
                {"name": f"Ticket20-data-{mode}", "mode": mode, "scenario": "normal"}
                if mode != "custom"
                else custom_task("Ticket20-data-custom", "normal")
            )
            task = client.post("/api/collection-tasks", json=payload).json()
            run = wait_for_completion(
                client,
                client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"],
            )
            if run["status"] != "completed":
                raise AssertionError(f"数据模式 {mode} 未完成：{run}")
            data_modes[mode] = {
                "run_id": run["id"],
                "duration_seconds": run["configuration_snapshot"]["duration_seconds"],
                "channels": run["configuration_snapshot"]["video"]["channels"],
            }
        evidence["data_modes"] = data_modes

        for scenario, method in (
            ("fixed_offset", "fixed_offset_anchor"),
            ("linear_drift", "linear_drift_regression"),
        ):
            task = client.post(
                "/api/collection-tasks",
                json={
                    "name": f"Ticket20-{scenario}",
                    "mode": "quick",
                    "scenario": scenario,
                },
            ).json()
            run = wait_for_completion(
                client,
                client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"],
            )
            evidence["alignment"][scenario] = {
                "run_id": run["id"],
                "method": run["alignment_result"]["method"],
            }
            if run["alignment_result"]["method"] != method:
                raise RuntimeError(
                    f"{scenario} 对齐方法不符：{run['alignment_result']}"
                )

        normal = evidence["scenarios"]["normal"]
        normal_run = client.get(f"/api/runs/{normal['run_id']}").json()
        manual = client.post(
            f"/api/runs/{normal['run_id']}/manual-check-results",
            json={
                "name": "Mock 外观检查",
                "status": "passed",
                "actual_result": "无异常",
                "notes": "验收演示",
            },
        ).json()
        report = client.get(f"/api/runs/{normal['run_id']}/report.html")
        report_json = client.get(f"/api/runs/{normal['run_id']}/report").json()
        archive = client.get(f"/api/runs/{normal['run_id']}/evidence.zip")
        if report.status_code != 200 or archive.status_code != 200:
            raise AssertionError(
                f"报告导出失败：HTML={report.status_code}, ZIP={archive.status_code}"
            )
        (args.output / "normal-report.html").write_bytes(report.content)
        (args.output / "normal-evidence.zip").write_bytes(archive.content)
        with zipfile.ZipFile(args.output / "normal-evidence.zip") as evidence_archive:
            archive_names = set(evidence_archive.namelist())
            if (
                "report.html" not in archive_names
                or "SHA256SUMS.txt" not in archive_names
            ):
                raise AssertionError(f"ZIP 缺少核心文件：{sorted(archive_names)}")
            if any(name.lower().endswith((".mp4", ".mkv")) for name in archive_names):
                raise AssertionError("ZIP 默认包含原始视频")
            manifest = json.loads(evidence_archive.read("evidence-manifest.json"))
            for item in manifest["hashed_files"]:
                digest = hashlib.sha256(evidence_archive.read(item["path"])).hexdigest()
                if digest != item["sha256"]:
                    raise AssertionError(f"ZIP 哈希不一致：{item['path']}")
        if report_json["automated_checks"] != normal_run["checks"]:
            raise AssertionError("报告覆盖了自动化检查事实")
        if report_json["manual_check_results"] != [manual]:
            raise AssertionError("报告未独立汇总人工结果")
        diagnosis_module.SiliconFlowAdapter = OfflineFailingAdapter
        degraded = client.post(
            f"/api/runs/{normal['run_id']}/diagnoses",
            json={"mode": "siliconflow", "api_key": ""},
        ).json()
        after_degradation = client.get(f"/api/runs/{normal['run_id']}").json()
        if degraded["status"] != "failed" or after_degradation["status"] != "completed":
            raise AssertionError("模型降级改变了原始运行结果")
        evidence["manual"] = manual
        evidence["report_and_zip"] = {
            "html_status": report.status_code,
            "zip_status": archive.status_code,
            "zip_contains_raw_video": any(
                name.lower().endswith((".mp4", ".mkv")) for name in archive_names
            ),
        }
        evidence["degradation"] = {
            "diagnosis_status": degraded["status"],
            "run_status": after_degradation["status"],
        }

    summary_path = args.output / "acceptance-summary.json"
    summary_path.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    allure_dir = args.output / "allure-results"
    allure_dir.mkdir(exist_ok=True)
    (allure_dir / "ticket20-acceptance-result.json").write_text(
        json.dumps(
            {
                "uuid": "ticket20-mock-acceptance",
                "historyId": "ticket20-mock-acceptance",
                "name": "Ticket 20 Mock 验收",
                "status": "passed",
                "labels": [{"name": "suite", "value": "Ticket 20"}],
                "attachments": [{"name": "acceptance-summary.json", "source": "acceptance-summary.json", "type": "application/json"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    evidence["security"] = {
        "artifact_scan_command": "scripts/check_artifact_safety.py",
        "repository_scan_command": "scripts/check_repository_safety.py",
        "raw_video_in_default_zip": evidence["report_and_zip"][
            "zip_contains_raw_video"
        ],
    }
    summary_path.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (allure_dir / "acceptance-summary.json").write_text(
        summary_path.read_text(encoding="utf-8"), encoding="utf-8"
    )
    print(f"Ticket 20 Mock 验收通过，证据目录：{args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
