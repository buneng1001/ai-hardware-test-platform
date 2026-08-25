import time

from fastapi.testclient import TestClient

from app import diagnosis as diagnosis_module
from app.main import app
from app.run_models import StructuredDiagnosis


def wait_for_completion(client: TestClient, run_id: int) -> dict:
    """通过公开运行详情接口等待确定性执行完成。"""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 10 秒内完成")


def test_mock_diagnosis_is_structured_repeatable_and_reported(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "Mock 诊断掉帧", "mode": "quick", "scenario": "video_drop"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        client.post(
            f"/api/runs/{run['id']}/manual-check-results",
            json={"name": "外观复核", "status": "blocked", "notes": "待补充现场照片"},
        )
        first = client.post(f"/api/runs/{run['id']}/diagnoses")
        second = client.post(f"/api/runs/{run['id']}/diagnoses")
        report = client.get(f"/api/runs/{run['id']}/report").json()
        reopened = client.get(f"/api/runs/{run['id']}/diagnoses").json()

    assert first.status_code == 201
    assert second.status_code == 201
    first_data = first.json()
    second_data = second.json()
    assert first_data["status"] == "completed"
    assert first_data["is_mock"] is True
    assert first_data["model"] == "mock-diagnosis-v1"
    assert first_data["prompt_version"] == "mock-v1"
    assert first_data["evidence_package"]["total_bytes"] <= first_data["evidence_package"]["max_bytes"]
    assert first_data["evidence_package"]["estimated_tokens"] <= first_data["evidence_package"]["max_tokens"]
    assert first_data["evidence_package"]["items"]
    assert all(item["ref"].startswith("E") for item in first_data["evidence_package"]["items"])
    diagnosis = first_data["output"]
    assert diagnosis["diagnosis_status"] == "completed"
    assert diagnosis["phenomena"]
    assert diagnosis["possible_causes"]
    assert diagnosis["impact_scope"]
    assert diagnosis["retest_recommendations"]
    assert diagnosis["missing_evidence"]
    assert diagnosis["uncertainties"]
    assert diagnosis["limitations"]
    evidence_refs = {item["ref"] for item in first_data["evidence_package"]["items"]}
    assert all(ref in evidence_refs for cause in diagnosis["possible_causes"] for ref in cause["evidence_refs"])
    assert first_data["output"] == second_data["output"]
    assert second_data["id"] != first_data["id"]
    assert len(reopened) == 2
    assert report["diagnosis"]["output"]["diagnosis_status"] == "completed"
    assert report["diagnosis"]["evidence_package"]["items"] == first_data["evidence_package"]["items"]


def test_diagnosis_does_not_change_test_execution_and_rejects_invalid_evidence_reference(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "Mock 诊断校验", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        def invalid_mock_output(current_run, package):
            return StructuredDiagnosis(
                diagnosis_status="completed",
                phenomena=[],
                possible_causes=[
                    {
                        "cause": "未证实",
                        "evidence_refs": ["E999"],
                        "confidence": "low",
                        "is_speculation": False,
                    }
                ],
                impact_scope=[],
                retest_recommendations=[],
                missing_evidence=[],
                uncertainties=[],
                limitations=[],
            )

        monkeypatch.setattr(diagnosis_module, "build_mock_diagnosis", invalid_mock_output)
        invalid = client.post(f"/api/runs/{run['id']}/diagnoses")
        after = client.get(f"/api/runs/{run['id']}").json()

    assert invalid.status_code == 422
    assert "证据引用" in invalid.json()["detail"]
    assert after["status"] == "completed"
    assert after["checks"]
