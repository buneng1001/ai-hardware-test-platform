"""Fact report HTML styling and evidence navigation contracts."""

from app.fact_report_rendering import _evidence_links
from tests import test_t05_report_ai_gate as t05

prepared = t05.prepared


def test_html_report_highlights_case_numbers_and_ai_evidence_links(prepared, monkeypatch):
    client, project_id, _, _, report = prepared
    t05.enable_ai(client, monkeypatch)
    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "mock")
    result = client.post(f"/api/fact-reports/{report['id']}/analysis")
    assert result.status_code == 201, result.text
    assert client.get(f"/api/fact-reports/{report['id']}").json()["project_id"] == project_id

    html = client.get(f"/api/fact-reports/{report['id']}.html").text
    assert "class='ai-status'" in html
    assert "<strong class='case-number'>SRC-A</strong>" in html
    assert "id='record-0-0'" in html
    assert "<a class='evidence-ref' href='#overview'>stage_progress</a>" in html


def test_report_evidence_references_link_to_their_fact_targets():
    rendered = _evidence_links(
        [
            "execution_context",
            "module:0",
            "record:0:0",
            "cross_issue:1",
            "history_report:14",
        ]
    )
    assert "href='#basic'" in rendered
    assert "href='#module-1'" in rendered
    assert "href='#record-0-0'" in rendered
    assert "href='#cross-issue-1'" in rendered
    assert "href='#history-report-14'" in rendered
