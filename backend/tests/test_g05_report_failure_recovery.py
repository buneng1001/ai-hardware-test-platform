"""Regression tests for the reported #14 failure path; isolated fixture database."""

import http.client

import pytest

from app import report_analysis
from app.ai_invocation import begin_invocation, recover_interrupted_invocations
from app.database import open_database
from app.siliconflow import ModelErrorKind, SiliconFlowAdapter, SiliconFlowError
from tests import test_t05_report_ai_gate as t05

prepared = t05.prepared


def test_cancelled_row_does_not_hide_later_failure(prepared, monkeypatch):
    client, _, _, _, report = prepared
    t05.enable_ai(client, monkeypatch)
    report_id = report["id"]
    report_analysis._record_cancelled(
        report_id,
        provider="deepseek",
        model="deepseek-flash",
        is_mock=False,
        analysis_input={},
        config_snapshot={},
    )

    class Adapter:
        request_logs = []

        def generate_json(self, **kwargs):
            raise SiliconFlowError(ModelErrorKind.NETWORK, "test transport failure", False)

    monkeypatch.setattr(report_analysis, "get_provider_adapter", lambda _: Adapter())
    response = client.post(f"/api/fact-reports/{report_id}/analysis")
    assert response.status_code == 201, response.text
    latest = client.get(f"/api/fact-reports/{report_id}").json()
    assert latest["analysis"]["status"] == "failed"
    assert latest["analysis"]["error"]["kind"] == "network"
    assert latest["snapshot"] == report["snapshot"]
    with open_database() as connection:
        rows = connection.execute(
            "SELECT status,is_active FROM report_analysis_runs WHERE report_id=? ORDER BY id",
            (report_id,),
        ).fetchall()
        assert [tuple(row) for row in rows] == [("cancelled", 0), ("failed", 1)]


def test_restart_shows_interrupted_run_without_automatic_replay(prepared, monkeypatch):
    client, project, _, _, report = prepared
    t05.enable_ai(client, monkeypatch)
    report_id = report["id"]
    report_analysis._record_cancelled(
        report_id,
        provider="deepseek",
        model="deepseek-flash",
        is_mock=False,
        analysis_input={},
        config_snapshot={},
    )
    begin_invocation(
        operation_type="report_analysis",
        project_id=project,
        resource_id=report_id,
        execution_mode="checkpointed_batch",
        input_fingerprint="a" * 64,
    )
    assert recover_interrupted_invocations() == 1
    current = client.get(f"/api/fact-reports/{report_id}").json()
    assert current["analysis"]["status"] == "failed"
    assert current["analysis"]["error"]["kind"] == "interrupted"
    assert current["snapshot"] == report["snapshot"]
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


@pytest.mark.parametrize(
    ("exception", "kind"),
    [
        (ConnectionResetError("private fixture"), ModelErrorKind.NETWORK),
        (http.client.IncompleteRead(b"private fixture"), ModelErrorKind.NETWORK),
        (TimeoutError("private fixture"), ModelErrorKind.TIMEOUT),
    ],
)
def test_transport_failure_is_classified_logged_and_not_replayed(exception, kind):
    def transport(_request):
        raise exception

    adapter = SiliconFlowAdapter(transport=transport, sleep=lambda _: None)
    with pytest.raises(SiliconFlowError) as caught:
        adapter.generate_json(
            api_key="fixture", model="fixture", evidence_json="{}", system_prompt="JSON", stage="report_analysis_batch"
        )
    assert caught.value.kind == kind
    assert caught.value.diagnostic == type(exception).__name__
    assert "private fixture" not in str(caught.value)
    assert len(adapter.request_logs) == 1
    assert adapter.request_logs[0]["error_kind"] == kind
    assert adapter.call_count == 1
