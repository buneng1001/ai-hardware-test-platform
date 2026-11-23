"""T05：报告事实与 AI 门控/安全快照/取消/检查点的真实 SQLite + Mock 接口验证。"""

import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app import report_analysis
from app import settings as settings_module
from app.database import open_database
from app.main import app


@pytest.fixture
def prepared(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "disabled")
    client = TestClient(app)
    project = client.post(
        "/api/projects", json={"name": "T05 项目", "product_name": "测试硬件", "product_profile": {"physical_keys": 3}}
    )
    assert project.status_code == 201, project.text
    project_id = project.json()["id"]
    version = client.post(
        f"/api/projects/{project_id}/product-versions", json={"version": "EVT-1", "ai_context": "原始版本要求"}
    )
    assert version.status_code == 201, version.text
    version_id = version.json()["id"]
    group = client.post(f"/api/product-versions/{version_id}/test-groups", json={"name": "T05 组"})
    assert group.status_code == 201, group.text
    group_id = group.json()["id"]
    imported = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={
            "source_filename": "t05.csv",
            "field_mapping": {"case_number": "编号", "title": "标题", "test_type": "类型", "module": "模块"},
            "rows": [
                {"编号": "SRC-A", "标题": "人工测试 A", "类型": "manual", "模块": "模块 A"},
                {"编号": "SRC-B", "标题": "人工测试 B", "类型": "manual", "模块": "模块 B"},
            ],
        },
    )
    assert imported.status_code == 201, imported.text
    cases = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
    case_ids = [case["id"] for case in cases]
    assert client.post(f"/api/test-groups/{group_id}/source-test-cases", json={"case_ids": case_ids}).status_code == 200
    batch = client.post(
        f"/api/test-groups/{group_id}/manual-test-result-batches",
        json={
            "results": [
                {"source_test_case_id": case_id, "status": "failed", "actual_result": "证据故障"}
                for case_id in case_ids
            ]
        },
    )
    assert batch.status_code == 201, batch.text
    report = client.post(
        f"/api/test-groups/{group_id}/fact-reports",
        json={"manual_batch_ids": [batch.json()["id"]]},
    )
    assert report.status_code == 201, report.text
    assert report.json()["analysis"]["status"] == "not_enabled"
    return client, project_id, version_id, group_id, report.json()


def enable_ai(client, monkeypatch):
    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "configured")
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "t05-mock-key-not-real")

    class ConnectionAdapter:
        def check_connection(self, **_kwargs):
            return None

    monkeypatch.setattr(settings_module, "get_provider_adapter", lambda _: ConnectionAdapter())
    config = {"provider": "deepseek", "model": "deepseek-flash", "key_source": "environment", "network_mode": "auto"}
    assert client.post("/api/settings/ai/config", json=config).status_code == 200
    checked = client.post(
        "/api/settings/ai/test",
        json={
            "provider": config["provider"],
            "model": config["model"],
            "key_source": config["key_source"],
        },
    )
    assert checked.status_code == 200 and checked.json()["ok"], checked.text
    enabled = client.put("/api/settings/ai/state", json={"enabled": True})
    assert enabled.status_code == 200 and enabled.json()["enabled"], enabled.text


def model_output(ref="stage_progress"):
    return {
        "risks": [{"content": "必须核查事实证据", "evidence_refs": [ref]}],
        "additional_verifications": [],
        "regression_recommendations": [],
        "stage_recommendation": {
            "suggestion": "人工复核",
            "content": "不得修改事实",
            "evidence_refs": ["stage_progress"],
        },
    }


def test_ai_off_does_not_block_fact_report_and_retry_is_gated(prepared, monkeypatch):
    client, _, _, group_id, report = prepared
    report_id = report["id"]
    original_fact = report["snapshot"]
    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "mock")
    # 即使报告分析本地设为 Mock，用户仍明确关闭全局 AI。
    rejected = client.post(f"/api/fact-reports/{report_id}/analysis")
    assert rejected.status_code == 409
    assert "全局 AI 已关闭" in rejected.json()["detail"]
    assert client.get(f"/api/fact-reports/{report_id}").json()["snapshot"] == original_fact
    assert client.get(f"/api/fact-reports/{report_id}/analysis/runs").json() == []
    fresh = client.post(
        f"/api/test-groups/{group_id}/fact-reports",
        json={"manual_batch_ids": report["manual_batch_ids"]},
    )
    assert fresh.status_code == 201
    assert fresh.json()["analysis"]["status"] == "not_enabled"
    assert fresh.json()["snapshot"]["scope_overview"] == original_fact["scope_overview"]


def test_success_snapshot_is_frozen_and_new_version_context_changes_fingerprint(prepared, monkeypatch):
    client, project_id, version_id, _, report = prepared
    enable_ai(client, monkeypatch)
    requests = []

    class Adapter:
        request_logs = []

        def generate_json(self, *, evidence_json, model, **_kwargs):
            requests.append((json.loads(evidence_json), model))
            return model_output()

    monkeypatch.setattr(report_analysis, "get_provider_adapter", lambda _: Adapter())
    report_id = report["id"]
    first = client.post(f"/api/fact-reports/{report_id}/analysis")
    assert first.status_code == 201, first.text
    assert first.json()["status"] == "completed"
    assert requests[0][0]["version_ai_context"] == "原始版本要求"
    assert requests[0][0]["product_profile"]["physical_keys"] == 3
    assert requests[0][1] == "deepseek-flash"
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None
    old_snapshot = client.get(f"/api/fact-reports/{report_id}").json()["snapshot"]
    assert old_snapshot == report["snapshot"]
    assert client.patch(f"/api/product-versions/{version_id}", json={"ai_context": "版本后续补充"}).status_code == 200
    assert client.put(f"/api/projects/{project_id}/product-profile", json={"physical_keys": 8}).status_code == 200
    new = client.post(f"/api/fact-reports/{report_id}/analysis")
    assert new.status_code == 201, new.text
    assert new.json()["status"] == "completed" and not new.json()["reused"]
    assert new.json()["fingerprint"] != first.json()["fingerprint"]
    assert requests[1][0]["version_ai_context"] == "版本后续补充"
    assert requests[1][0]["product_profile"]["physical_keys"] == 8
    history = client.get(f"/api/fact-reports/{report_id}/analysis/runs").json()
    assert len([row for row in history if row["status"] == "completed"]) == 2
    with open_database() as connection:
        snapshots = [
            json.loads(row["input_snapshot"])
            for row in connection.execute(
                "SELECT input_snapshot FROM report_analysis_runs WHERE report_id = ? "
                "AND status = 'completed' ORDER BY id",
                (report_id,),
            )
        ]
    assert snapshots[0]["version_ai_context"] == "原始版本要求"
    assert snapshots[1]["version_ai_context"] == "版本后续补充"
    assert client.get(f"/api/fact-reports/{report_id}").json()["snapshot"] == old_snapshot


def test_cancel_while_model_waits_preserves_old_success_and_global_lock(prepared, monkeypatch):
    client, project_id, version_id, _, report = prepared
    enable_ai(client, monkeypatch)
    report_id = report["id"]
    entered = threading.Event()
    released = threading.Event()
    calls = []

    class Adapter:
        request_logs = []

        def generate_json(self, *, evidence_json, **_kwargs):
            calls.append(json.loads(evidence_json))
            if len(calls) == 2:
                entered.set()
                assert released.wait(timeout=15)
            return model_output()

    monkeypatch.setattr(report_analysis, "get_provider_adapter", lambda _: Adapter())
    first = client.post(f"/api/fact-reports/{report_id}/analysis")
    assert first.status_code == 201 and first.json()["status"] == "completed", first.text
    prior_run = first.json()["run_id"]
    immutable = client.get(f"/api/fact-reports/{report_id}").json()["snapshot"]

    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(lambda: client.post(f"/api/fact-reports/{report_id}/analysis?force=true"))
        try:
            assert entered.wait(timeout=15)
            active = client.get("/api/settings/ai/active-invocation").json()["active"]
            assert active["operation_type"] == "report_analysis"
            assert active["project_id"] == project_id and active["resource_id"] == report_id
            assert (
                client.patch(f"/api/product-versions/{version_id}", json={"ai_context": "调用中变化"}).status_code
                == 200
            )
            assert (
                client.put(f"/api/projects/{project_id}/product-profile", json={"physical_keys": 40}).status_code == 200
            )
            assert calls[-1]["version_ai_context"] == "原始版本要求"
            assert calls[-1]["product_profile"]["physical_keys"] == 3
            stopped = client.post(f"/api/fact-reports/{report_id}/analysis/cancel")
            assert stopped.status_code == 200 and stopped.json()["stopping"], stopped.text
            current = client.get(f"/api/fact-reports/{report_id}").json()["analysis"]
            assert current["status"] == "pending" and current["stopping"]
            assert client.post(f"/api/fact-reports/{report_id}/analysis?force=true").status_code == 409
            assert client.put("/api/settings/ai/state", json={"enabled": False}).status_code == 409
            assert not pending.done()
        finally:
            released.set()
        finished = pending.result(timeout=15)
    assert finished.status_code == 201 and finished.json()["status"] == "cancelled", finished.text
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None

    after = client.get(f"/api/fact-reports/{report_id}").json()
    assert after["analysis"]["run_id"] == prior_run
    assert after["analysis"]["status"] == "completed"
    assert after["snapshot"] == immutable
    history = client.get(f"/api/fact-reports/{report_id}/analysis/runs").json()
    assert any(row["status"] == "cancelled" for row in history)
    assert sum(row["status"] == "completed" for row in history) == 1
    assert client.put("/api/settings/ai/state", json={"enabled": False}).status_code == 200


def test_background_pending_is_published_then_finally_cleared(prepared, monkeypatch):
    client, _, _, _, report = prepared
    enable_ai(client, monkeypatch)
    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "mock")
    report_id = report["id"]
    with open_database() as connection:
        report_analysis.enqueue_analysis(connection, report_id)
    initial = client.get(f"/api/fact-reports/{report_id}").json()
    assert initial["analysis"]["status"] == "pending"
    report_analysis.run_analysis_in_background(report_id)
    final = client.get(f"/api/fact-reports/{report_id}").json()
    assert final["analysis"]["status"] == "completed"
    assert final["snapshot"] == report["snapshot"]
    with open_database() as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM report_analysis_runs WHERE report_id = ? AND status = 'pending'",
                (report_id,),
            ).fetchone()[0]
            == 0
        )


def test_cancel_before_background_lease_prevents_start(prepared, monkeypatch):
    client, _, _, _, report = prepared
    enable_ai(client, monkeypatch)
    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "mock")
    report_id = report["id"]
    with open_database() as connection:
        report_analysis.enqueue_analysis(connection, report_id)
    cancel = client.post(f"/api/fact-reports/{report_id}/analysis/cancel")
    assert cancel.status_code == 200 and not cancel.json()["stopping"]
    report_analysis.run_analysis_in_background(report_id)
    result = client.get(f"/api/fact-reports/{report_id}").json()
    assert result["analysis"]["status"] == "cancelled"
    assert result["snapshot"] == report["snapshot"]
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


def test_batched_cancel_retains_only_completed_checkpoint(prepared, monkeypatch):
    client, _, _, _, report = prepared
    enable_ai(client, monkeypatch)
    monkeypatch.setenv("AI_BATCH_MODULES_PER_BATCH", "1")
    entered = threading.Event()
    released = threading.Event()
    calls = []

    class Adapter:
        request_logs = []

        def generate_json(self, *, evidence_json, **_kwargs):
            batch = json.loads(evidence_json)
            calls.append(batch)
            if len(calls) == 2:
                entered.set()
                assert released.wait(timeout=15)
            return model_output(batch["refs"][1])

    monkeypatch.setattr(report_analysis, "get_provider_adapter", lambda _: Adapter())
    report_id = report["id"]
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(lambda: client.post(f"/api/fact-reports/{report_id}/analysis"))
        try:
            assert entered.wait(timeout=15)
            assert calls[0]["version_ai_context"] == "原始版本要求"
            assert calls[1]["product_profile"]["physical_keys"] == 3
            assert client.post(f"/api/fact-reports/{report_id}/analysis/cancel").status_code == 200
            assert client.get("/api/settings/ai/active-invocation").json()["active"]["stopping"]
            with open_database() as connection:
                cached = connection.execute(
                    "SELECT COUNT(*) FROM report_analysis_batches WHERE report_id = ? AND status = 'completed'",
                    (report_id,),
                ).fetchone()[0]
            assert cached == 1
        finally:
            released.set()
        finished = pending.result(timeout=15)
    assert finished.status_code == 201 and finished.json()["status"] == "cancelled"
    with open_database() as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM report_analysis_batches WHERE report_id = ? AND status = 'completed'",
                (report_id,),
            ).fetchone()[0]
            == 1
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM report_analysis_runs WHERE report_id = ? AND output IS NOT NULL",
                (report_id,),
            ).fetchone()[0]
            == 0
        )
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None
