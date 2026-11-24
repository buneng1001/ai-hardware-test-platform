"""T15 API validation against saved fact reports and the global AI lease."""

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from app import intelligent_regression as regression
from app.database import open_database
from app.siliconflow import ModelErrorKind, SiliconFlowError
from tests import test_t05_report_ai_gate as t05
from tests.test_t13_report_source_snapshot import _batch, _create_group, _report

prepared = t05.prepared
enable_ai = t05.enable_ai


def endpoint(report):
    return f"/api/fact-reports/{report['id']}/intelligent-regression"


def ready(prepared, monkeypatch):
    client, _, _, _, report = prepared
    enable_ai(client, monkeypatch)
    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "mock")
    assert client.post(f"/api/fact-reports/{report['id']}/analysis").json()["status"] == "completed"
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "mock")
    return client, report


def test_main_requires_successful_analysis(prepared, monkeypatch):
    client, _, _, _, report = prepared
    enable_ai(client, monkeypatch)
    response = client.post(endpoint(report), json={"report_ids": []})
    assert response.status_code == 409, response.text


def test_complete_mock_uses_only_snapshot(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    response = client.post(endpoint(report), json={"report_ids": []})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["is_mock"] and data["key_changes"] is None
    assert data["candidate_count"] == len(data["candidates"]) > 0
    assert all(c["source_findings"] and c["steps"] and c["expected_result"] for c in data["candidates"])
    assert set(data["report_fingerprints"]) == {str(report["id"])}
    assert client.get(f"/api/fact-reports/{report['id']}").json()["snapshot"] == report["snapshot"]
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


@pytest.mark.parametrize("damage", ["missing", "unknown_ref", "cross_version", "blank"])
def test_rejects_invalid_model_output(prepared, monkeypatch, damage):
    client, report = ready(prepared, monkeypatch)
    original = regression._mock_output

    def invalid(inputs):
        raw = original(inputs)
        if damage == "missing":
            del raw["candidates"][0]["steps"]
        elif damage == "unknown_ref":
            raw["candidates"][0]["sources"][0]["evidence_ref"] = "nonexistent"
        elif damage == "cross_version":
            raw["key_changes"] = raw["overall_risk"]
        else:
            raw["candidates"][0]["steps"] = " "
        return raw

    monkeypatch.setattr(regression, "_mock_output", invalid)
    result = client.post(endpoint(report), json={"report_ids": []})
    assert result.status_code == 422, result.text
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


def test_invalid_snapshot_and_auxiliary(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    assert client.post(endpoint(report), json={"report_ids": [report["id"]]}).status_code == 422
    assert client.post(endpoint(report), json={"report_ids": [99999999]}).status_code == 422
    with open_database() as connection:
        connection.execute("UPDATE online_reports SET snapshot = '{}' WHERE id = ?", (report["id"],))
    assert client.post(endpoint(report), json={"report_ids": []}).status_code == 422


def test_auxiliary_report_without_ai_and_snapshot_context(prepared, monkeypatch):
    client, project_id, version_id, _, report = prepared
    _, other_version, other_group = _create_group(client, project_id=project_id, version="EVT-0")
    _, batch = _batch(client, other_version, other_group, "passed")
    auxiliary = _report(client, other_group, automation_execution_id=None, manual_batch_ids=[batch]).json()
    assert auxiliary["analysis"]["status"] == "not_enabled"
    client, report = ready(prepared, monkeypatch)
    original = regression._mock_output
    observed = []

    def mock(inputs):
        observed.append(inputs)
        assert inputs["main"]["facts"]["pass_rate"]["overall"]["failed"] == 2
        assert inputs["auxiliary"][0]["facts"]["pass_rate"]["overall"]["passed"] == 1
        assert inputs["auxiliary"][0]["overall_analysis"] is None
        assert inputs["product_profile"]["physical_keys"] == 3
        return original(inputs)

    monkeypatch.setattr(regression, "_mock_output", mock)
    first = client.post(endpoint(report), json={"report_ids": [auxiliary["id"]]})
    assert first.status_code == 200, first.text
    assert observed[0]["version_ai_context"] == "原始版本要求"
    assert first.json()["key_changes"]["evidence_refs"][1]["report_id"] == auxiliary["id"]
    with open_database() as connection:
        connection.execute("UPDATE product_versions SET ai_context = '新说明' WHERE id = ?", (version_id,))
    next_result = client.post(endpoint(report), json={"report_ids": [auxiliary["id"]]})
    assert next_result.status_code == 200, next_result.text
    assert observed[1]["version_ai_context"] == "新说明"
    assert next_result.json()["ai_context_fingerprint"] != first.json()["ai_context_fingerprint"]


def test_cancel_discards_late_result_and_retains_lock(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    original = regression._mock_output
    entered, release = threading.Event(), threading.Event()

    def slow(inputs):
        entered.set()
        assert release.wait(10)
        return original(inputs)

    monkeypatch.setattr(regression, "_mock_output", slow)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(client.post, endpoint(report), json={"report_ids": []})
        try:
            assert entered.wait(10)
            assert client.post(endpoint(report), json={"report_ids": []}).status_code == 409
            assert client.post(endpoint(report) + "/cancel").status_code == 200
            active = client.get("/api/settings/ai/active-invocation").json()["active"]
            assert active["operation_type"] == "intelligent_regression" and active["stopping"]
        finally:
            release.set()
        response = future.result(timeout=10)
        assert response.status_code == 409, response.text
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None
    assert client.get(f"/api/fact-reports/{report['id']}").json()["snapshot"] == report["snapshot"]


@pytest.mark.parametrize("kind", ["output_truncated", "timeout"])
def test_adapter_failure_is_atomic(prepared, monkeypatch, kind):
    client, report = ready(prepared, monkeypatch)
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")

    class FailedAdapter:
        def generate_json(self, **kwargs):
            raise SiliconFlowError(ModelErrorKind(kind), "fixture failure", False)

    monkeypatch.setattr(regression, "get_provider_adapter", lambda _: FailedAdapter())
    response = client.post(endpoint(report), json={"report_ids": []})
    assert response.status_code == 422, response.text
    assert "截断" in response.json()["detail"] if kind == "output_truncated" else "超时" in response.json()["detail"]
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None
