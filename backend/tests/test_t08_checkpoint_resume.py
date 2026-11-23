"""T08: explicit batch resume, restart, fingerprint isolation and persisted interruption."""

from test_automation_case_ai_conversion import DecisionAdapter, create_version_with_source_cases
from test_automation_case_ai_conversion import client as conversion_client_fixture
from test_t05_report_ai_gate import enable_ai, model_output
from test_t05_report_ai_gate import prepared as report_prepared_fixture

from app import report_analysis
from app.ai_batching import BatchConfig
from app.ai_invocation import get_active_invocation, recover_interrupted_invocations, request_invocation_cancel
from app.database import open_database
from app.siliconflow import ModelErrorKind, SiliconFlowError

client = conversion_client_fixture
prepared = report_prepared_fixture


def _conversion_url(version_id: int) -> str:
    return f"/api/product-versions/{version_id}/automation-test-case-conversions/ai"


def _cancel_after_one_batch(monkeypatch):
    monkeypatch.setattr("app.automation_conversion_ai.batch_config", lambda: BatchConfig(cases_per_batch=1))

    class CancellingAdapter(DecisionAdapter):
        def generate_json(self, **kwargs):
            if self.calls == 1:
                active = get_active_invocation().active
                assert active is not None
                request_invocation_cancel(active.invocation_id)
            return super().generate_json(**kwargs)

    adapter = CancellingAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: adapter)
    return adapter


def test_conversion_continue_does_not_repeat_committed_unit(client, monkeypatch):
    version_id = create_version_with_source_cases(client)
    first_adapter = _cancel_after_one_batch(monkeypatch)
    url = _conversion_url(version_id)
    first = client.post(url, json={"mode": "all"})
    assert first.status_code == 409 and "取消" in first.json()["detail"]
    assert first_adapter.calls == 2

    with open_database() as connection:
        failed = connection.execute(
            """SELECT invocation_id, status FROM ai_batch_runs
               WHERE operation_type = 'automation_conversion' ORDER BY rowid DESC LIMIT 1"""
        ).fetchone()
        assert failed["status"] == "cancelled"
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM ai_batch_units WHERE invocation_id = ?", (failed["invocation_id"],)
            ).fetchone()[0]
            == 1
        )

    without_choice = client.post(url, json={"mode": "all"})
    assert without_choice.status_code == 409
    assert "有效检查点" in without_choice.json()["detail"]
    assert first_adapter.calls == 2
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: adapter)
    resumed = client.post(url, json={"mode": "all", "resume_choice": "continue"})
    assert resumed.status_code == 201, resumed.text
    assert adapter.calls == 1
    assert len(resumed.json()["decisions"]) == 2

    with open_database() as connection:
        latest = connection.execute(
            """SELECT invocation_id, resumed_from_invocation_id, status FROM ai_batch_runs
               WHERE operation_type = 'automation_conversion' ORDER BY rowid DESC LIMIT 1"""
        ).fetchone()
        assert latest["resumed_from_invocation_id"] == failed["invocation_id"]
        assert latest["status"] == "completed"
        cases = connection.execute(
            "SELECT COUNT(*) FROM automation_test_cases WHERE product_version_id = ?", (version_id,)
        ).fetchone()[0]
        assert cases == 1


def test_conversion_restart_reprocesses_all_units(client, monkeypatch):
    version_id = create_version_with_source_cases(client)
    _cancel_after_one_batch(monkeypatch)
    url = _conversion_url(version_id)
    assert client.post(url, json={"mode": "all"}).status_code == 409
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: adapter)
    result = client.post(url, json={"mode": "all", "resume_choice": "restart"})
    assert result.status_code == 201, result.text
    assert adapter.calls == 2
    with open_database() as connection:
        last = connection.execute(
            "SELECT resumed_from_invocation_id FROM ai_batch_runs ORDER BY rowid DESC LIMIT 1"
        ).fetchone()
        assert last["resumed_from_invocation_id"] is None


def test_conversion_changed_context_invalidates_checkpoint(client, monkeypatch):
    version_id = create_version_with_source_cases(client)
    _cancel_after_one_batch(monkeypatch)
    url = _conversion_url(version_id)
    assert client.post(url, json={"mode": "all"}).status_code == 409
    changed = client.patch(f"/api/product-versions/{version_id}", json={"ai_context": "new version input"})
    assert changed.status_code == 200
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: adapter)
    refused = client.post(url, json={"mode": "all", "resume_choice": "continue"})
    assert refused.status_code == 409
    assert adapter.calls == 0
    fresh = client.post(url, json={"mode": "all"})
    assert fresh.status_code == 201, fresh.text
    assert adapter.calls == 2


def test_report_resume_and_restart_requires_explicit_choice(prepared, monkeypatch):
    client, _, _, _, report = prepared
    enable_ai(client, monkeypatch)
    monkeypatch.setattr(report_analysis, "batch_config", lambda: BatchConfig(modules_per_batch=1))
    report_id = report["id"]
    url = f"/api/fact-reports/{report_id}/analysis"

    class FailSecond:
        request_logs = []

        def __init__(self):
            self.calls = 0

        def generate_json(self, **kwargs):
            self.calls += 1
            if self.calls == 2:
                raise SiliconFlowError(ModelErrorKind.CONNECTION, "failed second batch", False, stage="report_analysis")
            return model_output()

    failed_adapter = FailSecond()
    monkeypatch.setattr(report_analysis, "get_provider_adapter", lambda _: failed_adapter)
    first = client.post(url)
    assert first.status_code == 201 and first.json()["status"] == "failed", first.text
    info = client.get(f"{url}/repeat-info")
    assert info.status_code == 200 and info.json()["resume_available"] is True
    assert client.post(url).status_code == 409

    class Complete:
        request_logs = []

        def __init__(self):
            self.calls = 0

        def generate_json(self, **kwargs):
            self.calls += 1
            return model_output()

    adapter = Complete()
    monkeypatch.setattr(report_analysis, "get_provider_adapter", lambda _: adapter)
    resumed = client.post(f"{url}?resume_choice=continue")
    assert resumed.status_code == 201 and resumed.json()["status"] == "completed", resumed.text
    assert adapter.calls == 1
    with open_database() as connection:
        runs = connection.execute(
            """SELECT invocation_id, resumed_from_invocation_id, status
               FROM ai_batch_runs WHERE operation_type = 'report_analysis' ORDER BY rowid"""
        ).fetchall()
        assert runs[0]["status"] == "failed"
        assert runs[1]["resumed_from_invocation_id"] == runs[0]["invocation_id"]
        assert runs[1]["status"] == "completed"


def test_resume_chain_keeps_ancestor_checkpoint_after_second_failure(client, monkeypatch):
    version_id = create_version_with_source_cases(client)
    _cancel_after_one_batch(monkeypatch)
    url = _conversion_url(version_id)
    assert client.post(url, json={"mode": "all"}).status_code == 409

    class AlwaysFails(DecisionAdapter):
        def generate_json(self, **kwargs):
            self.calls += 1
            raise SiliconFlowError(ModelErrorKind.CONNECTION, "temporary outage", False, stage="automation_conversion")

    failed_adapter = AlwaysFails()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: failed_adapter)
    failed = client.post(url, json={"mode": "all", "resume_choice": "continue"})
    assert failed.status_code == 502, failed.text
    assert failed_adapter.calls == 1
    assert client.post(url, json={"mode": "all"}).status_code == 409

    succeeding = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: succeeding)
    final = client.post(url, json={"mode": "all", "resume_choice": "continue"})
    assert final.status_code == 201, final.text
    assert succeeding.calls == 1
    with open_database() as connection:
        lineage = connection.execute(
            """SELECT status, resumed_from_invocation_id FROM ai_batch_runs
               WHERE operation_type = 'automation_conversion' ORDER BY rowid"""
        ).fetchall()
        assert [row["status"] for row in lineage] == ["cancelled", "failed", "completed"]
        assert lineage[1]["resumed_from_invocation_id"] is not None
        assert lineage[2]["resumed_from_invocation_id"] is not None


def test_conversion_batch_size_change_disallows_old_checkpoint(client, monkeypatch):
    version_id = create_version_with_source_cases(client)
    _cancel_after_one_batch(monkeypatch)
    url = _conversion_url(version_id)
    assert client.post(url, json={"mode": "all"}).status_code == 409
    monkeypatch.setattr("app.automation_conversion_ai.batch_config", lambda: BatchConfig(cases_per_batch=2))
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: adapter)
    response = client.post(url, json={"mode": "all", "resume_choice": "continue"})
    assert response.status_code == 409
    assert adapter.calls == 0
    fresh = client.post(url, json={"mode": "all"})
    assert fresh.status_code == 201, fresh.text
    assert adapter.calls == 1


def test_recover_running_batch_without_automatic_model_call(client):
    version_id = create_version_with_source_cases(client)
    from app.ai_invocation import begin_invocation

    lease = begin_invocation(
        operation_type="automation_conversion",
        resource_id=version_id,
        execution_mode="checkpointed_batch",
        input_fingerprint="a" * 64,
    )
    assert recover_interrupted_invocations() == 1
    assert get_active_invocation().active is None
    with open_database() as connection:
        row = connection.execute(
            "SELECT status FROM ai_batch_runs WHERE invocation_id = ?", (lease.invocation_id,)
        ).fetchone()
        assert row["status"] == "interrupted"
    assert recover_interrupted_invocations() == 0
