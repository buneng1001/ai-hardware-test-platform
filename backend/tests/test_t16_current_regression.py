"""T16: project-current replacement, cancellation and failure atomicity for AI-first G05."""

import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

from app import intelligent_regression as regression
from app.ai_invocation import recover_interrupted_invocations
from app.database import open_database
from tests import test_t15_intelligent_regression as t15

prepared = t15.prepared


def _current(client, group):
    response = client.get(f"/api/test-groups/{group}/intelligent-regression/current")
    assert response.status_code == 200, response.text
    return response.json()["result"]


def _generate(client, report, *, force=False, resume=False):
    response = client.post(
        t15.endpoint(report) + ("?force=true" if force else ""),
        json={"report_ids": [], "resume": resume},
    )
    return response


def test_project_current_repeat_and_refresh(prepared, monkeypatch):
    client, project, _, group, _ = prepared
    client, report = t15.ready(prepared, monkeypatch)
    assert _current(client, group) is None
    first = _generate(client, report)
    assert first.status_code == 200, first.text
    assert _current(client, group) == first.json()
    _, _, other_group = t15._create_group(client, project_id=project, version="EVT-2")
    assert _current(client, other_group) == first.json()
    _, _, foreign_group = t15._create_group(client, version="FOREIGN")
    assert _current(client, foreign_group) is None
    info = client.post(t15.endpoint(report) + "/repeat-info", json={"report_ids": []}).json()
    assert info["same_input"] and info["has_previous"] and not info["running_same_operation"]
    rejected = _generate(client, report)
    assert rejected.status_code == 409
    assert _current(client, group) == first.json()
    second = _generate(client, report, force=True)
    assert second.status_code == 200, second.text
    assert second.json()["invocation_id"] != first.json()["invocation_id"]
    assert _current(client, group) == second.json()
    assert _current(client, other_group) == second.json()
    with open_database() as connection:
        rows = connection.execute("SELECT * FROM current_regression_recommendations").fetchall()
        assert len(rows) == 1 and rows[0]["project_id"] == project
        assert rows[0]["invocation_id"] == second.json()["invocation_id"]
        assert connection.execute("PRAGMA user_version").fetchone()[0] >= 43
    assert client.get(f"/api/fact-reports/{report['id']}").json()["snapshot"] == report["snapshot"]


def test_failed_save_and_invalid_ai_output_leave_current_intact(prepared, monkeypatch):
    client, _, _, group, _ = prepared
    client, report = t15.ready(prepared, monkeypatch)
    first = _generate(client, report).json()
    original_save = regression._save_current

    def fail_after_write(connection, result):
        original_save(connection, result)
        raise sqlite3.OperationalError("fixture write failure")

    monkeypatch.setattr(regression, "_save_current", fail_after_write)
    failed = _generate(client, report, force=True)
    assert failed.status_code == 500, failed.text
    assert _current(client, group) == first
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None
    monkeypatch.setattr(regression, "_save_current", original_save)
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")

    class InvalidAdapter:
        request_logs = []

        def generate_json(self, **kwargs):
            payload = json.loads(kwargs["evidence_json"])
            if kwargs["stage"] == "intelligent_regression_module":
                return t15._module_output(payload, report["id"])
            return t15._global_output(report["id"], payload, invalid_evidence=True)

    monkeypatch.setattr(regression, "get_provider_adapter", lambda _provider: InvalidAdapter())
    invalid = _generate(client, report, force=True)
    assert invalid.status_code == 422, invalid.text
    assert "证据引用不存在" in invalid.json()["detail"]
    assert _current(client, group) == first
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


def test_cancel_before_commit_keeps_old_and_blocks_concurrent_call(prepared, monkeypatch):
    client, _, _, group, _ = prepared
    client, report = t15.ready(prepared, monkeypatch)
    first = _generate(client, report).json()
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")
    entered, release = threading.Event(), threading.Event()

    class SlowAdapter:
        request_logs = []

        def generate_json(self, **kwargs):
            entered.set()
            assert release.wait(15)
            payload = json.loads(kwargs["evidence_json"])
            if kwargs["stage"] == "intelligent_regression_module":
                return t15._module_output(payload, report["id"])
            return t15._global_output(report["id"], payload)

    monkeypatch.setattr(regression, "get_provider_adapter", lambda _provider: SlowAdapter())
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_generate, client, report, force=True)
        try:
            assert entered.wait(10)
            info = client.post(t15.endpoint(report) + "/repeat-info", json={"report_ids": []}).json()
            assert info["running_same_operation"] and info["active_invocation_id"]
            assert _generate(client, report, force=True).status_code == 409
            assert client.post(t15.endpoint(report) + "/cancel").status_code == 200
            assert _current(client, group) == first
        finally:
            release.set()
        assert future.result(timeout=15).status_code == 409
    assert _current(client, group) == first
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


def test_interrupted_recovery_retains_current(prepared, monkeypatch):
    client, project, _, group, _ = prepared
    client, report = t15.ready(prepared, monkeypatch)
    first = _generate(client, report).json()
    regression.begin_invocation(
        operation_type="intelligent_regression",
        project_id=project,
        resource_id=report["id"],
    )
    assert recover_interrupted_invocations() == 1
    assert _current(client, group) == first
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


def test_legacy_current_result_is_visible_as_incomplete_not_as_success(prepared, monkeypatch):
    client, _, _, group, _ = prepared
    client, report = t15.ready(prepared, monkeypatch)
    current = _generate(client, report).json()
    payload = dict(current)
    payload["schema_version"] = 1
    payload.pop("analysis_sections", None)
    payload.pop("generation_status", None)
    payload["generation_mode"] = "local"
    payload["ai_enhancement_status"] = "not_requested"
    with open_database() as connection:
        connection.execute(
            "UPDATE current_regression_recommendations SET payload = ? WHERE project_id = ?",
            (json.dumps(payload, ensure_ascii=False), current["project_id"]),
        )
    restored = _current(client, group)
    assert restored["generation_status"] == "legacy_incomplete"
    assert restored["schema_version"] == 1
