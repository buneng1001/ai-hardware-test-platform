import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def _wait_for_completion(client: TestClient, run_id: int) -> dict:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 15 秒内完成")


def _payload(mode: str) -> dict:
    return {
        "name": f"判定模式-{mode}",
        "mode": "quick",
        "scenario": "normal",
        "evaluation": {
            "mode": mode,
            "threshold_source": {
                "requirements_acceptance": "formal_specification",
                "engineering_target": "engineering_target",
                "baseline_analysis": "version_baseline",
            }[mode],
            "thresholds": {} if mode == "baseline_analysis" else {"max_failed_checks": 0},
            "priority": [
                "formal_specification",
                "engineering_target",
                "version_baseline",
            ],
        },
    }


@pytest.mark.parametrize(
    ("mode", "expected_conclusion", "product_commitment"),
    [
        ("requirements_acceptance", "passed", True),
        ("engineering_target", "passed", False),
        ("baseline_analysis", "not_applicable", False),
    ],
)
def test_run_evaluation_modes_are_observable_and_snapshot_is_immutable(
    tmp_path, monkeypatch, mode, expected_conclusion, product_commitment
):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        task_response = client.post("/api/collection-tasks", json=_payload(mode))
        assert task_response.status_code == 201, task_response.text
        task = task_response.json()
        assert task["evaluation"] == _payload(mode)["evaluation"]

        run_id = client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"]
        run = _wait_for_completion(client, run_id)

    assert run["configuration_snapshot"]["evaluation"] == task["evaluation"]
    result = run["evaluation_result"]
    assert result["mode"] == mode
    assert result["threshold_source"] == task["evaluation"]["threshold_source"]
    assert result["conclusion"] == expected_conclusion
    assert result["is_product_commitment"] is product_commitment


@pytest.mark.parametrize(
    "evaluation",
    [
        {
            "mode": "requirements_acceptance",
            "threshold_source": "formal_specification",
            "thresholds": {"max_failed_checks": -1},
        },
        {
            "mode": "requirements_acceptance",
            "threshold_source": "formal_specification",
            "thresholds": {"unknown": 1},
        },
        {
            "mode": "baseline_analysis",
            "threshold_source": "formal_specification",
            "thresholds": {"max_failed_checks": 0},
        },
        {
            "mode": "requirements_acceptance",
            "threshold_source": "formal_specification",
            "thresholds": {"max_failed_checks": 0.5},
        },
    ],
)
def test_invalid_evaluation_thresholds_are_rejected_before_task_is_saved(client, evaluation):
    response = client.post(
        "/api/collection-tasks",
        json={"name": "非法判定配置", "mode": "quick", "scenario": "normal", "evaluation": evaluation},
    )

    assert response.status_code == 422
    assert client.get("/api/collection-tasks").json() == []
