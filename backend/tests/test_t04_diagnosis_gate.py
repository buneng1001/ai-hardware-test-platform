"""T04 diagnosis admission and late-response cancellation, real SQLite + stub adapter."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app import diagnosis as diagnosis_module
from app import settings as settings_module
from app.main import app


def prepare(client, monkeypatch):
    client.post(
        "/api/settings/ai/config",
        json={"provider": "deepseek", "model": "deepseek-flash", "key_source": "environment", "network_mode": "auto"},
    )

    class Verified:
        def check_connection(self, **kwargs):
            return None

    monkeypatch.setattr(settings_module, "get_provider_adapter", lambda _: Verified())
    verification = client.post(
        "/api/settings/ai/test",
        json={"provider": "deepseek", "model": "deepseek-flash", "key_source": "environment"},
    )
    assert verification.status_code == 200, verification.text
    assert client.put("/api/settings/ai/state", json={"enabled": True}).status_code == 200
    task = client.post(
        "/api/collection-tasks",
        json={"name": "T04 诊断", "mode": "quick", "scenario": "normal"},
    ).json()
    run_id = client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"]
    for _ in range(1500):
        if client.get(f"/api/runs/{run_id}").json()["status"] == "completed":
            return run_id
        time.sleep(0.01)
    raise AssertionError("run did not finish")


def payload():
    return {"mode": "deepseek", "provider": "deepseek", "model": "deepseek-flash"}


def test_disabled_and_occupied_reject_without_model_request(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        run_id = prepare(client, monkeypatch)
        assert client.put("/api/settings/ai/state", json={"enabled": False}).status_code == 200
        denied = client.post(f"/api/runs/{run_id}/diagnoses", json=payload())
        assert denied.status_code == 409 and "已关闭" in denied.json()["detail"]
        assert client.get(f"/api/runs/{run_id}/diagnoses").json() == []
        client.put("/api/settings/ai/state", json={"enabled": True})

        started, release = threading.Event(), threading.Event()

        class Adapter:
            def generate(self, **kwargs):
                started.set()
                assert release.wait(timeout=10)
                return {
                    "diagnosis_status": "completed",
                    "phenomena": [],
                    "possible_causes": [],
                    "impact_scope": [],
                    "retest_recommendations": [],
                    "missing_evidence": [],
                    "uncertainties": [],
                    "limitations": [],
                }

        monkeypatch.setattr(diagnosis_module, "get_provider_adapter", lambda _: Adapter())
        with ThreadPoolExecutor(max_workers=2) as pool:
            future = pool.submit(client.post, f"/api/runs/{run_id}/diagnoses", json=payload())
            try:
                assert started.wait(timeout=10)
                second = client.post(f"/api/runs/{run_id}/diagnoses", json=payload())
                assert second.status_code == 409
                assert "占用 AI" in second.json()["detail"]
            finally:
                release.set()
            assert future.result(timeout=10).status_code == 201
        assert len(client.get(f"/api/runs/{run_id}/diagnoses").json()) == 1


def test_cancel_keeps_lease_until_return_and_discards_late_output(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        run_id = prepare(client, monkeypatch)
        prior = client.post(f"/api/runs/{run_id}/diagnoses", json={"mode": "mock"})
        assert prior.status_code == 201
        started, release = threading.Event(), threading.Event()

        class Adapter:
            def generate(self, **kwargs):
                started.set()
                assert release.wait(timeout=10)
                return {
                    "diagnosis_status": "completed",
                    "phenomena": [],
                    "possible_causes": [],
                    "impact_scope": [],
                    "retest_recommendations": [],
                    "missing_evidence": [],
                    "uncertainties": [],
                    "limitations": [],
                }

        monkeypatch.setattr(diagnosis_module, "get_provider_adapter", lambda _: Adapter())
        with ThreadPoolExecutor(max_workers=2) as pool:
            future = pool.submit(client.post, f"/api/runs/{run_id}/diagnoses", json=payload())
            try:
                assert started.wait(timeout=10)
                active = client.get("/api/settings/ai/active-invocation").json()["active"]
                assert active["resource_id"] == run_id and active["operation_type"] == "diagnosis"
                stop = client.post(f"/api/settings/ai/invocations/{active['invocation_id']}/cancel")
                assert stop.status_code == 200 and stop.json()["stopping"]
                assert client.get("/api/settings/ai/active-invocation").json()["active"]["stopping"]
                busy = client.post(f"/api/runs/{run_id}/diagnoses", json=payload())
                assert busy.status_code == 409
            finally:
                release.set()
            finished = future.result(timeout=10)
        assert finished.status_code == 201, finished.text
        assert finished.json()["status"] == "cancelled"
        assert finished.json()["output"] is None
        history = client.get(f"/api/runs/{run_id}/diagnoses").json()
        assert len(history) == 2
        assert history[0]["id"] == prior.json()["id"]
        assert history[0]["output"] == prior.json()["output"]
        assert history[1]["output"] is None
        report = client.get(f"/api/runs/{run_id}/report").json()
        assert report["diagnosis"]["id"] == prior.json()["id"]
        assert report["diagnosis"]["output"] == prior.json()["output"]
        assert client.get("/api/settings/ai/active-invocation").json()["active"] is None
        assert client.get(f"/api/runs/{run_id}").json()["status"] == "completed"


def test_unbound_collection_run_does_not_borrow_another_versions_context(tmp_path, monkeypatch):
    """Collection runs currently have no explicit product-version foreign key."""
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        project = client.post(
            "/api/projects",
            json={"name": "T04 独立项目", "product_name": "Device", "description": ""},
        ).json()
        version = client.post(
            f"/api/projects/{project['id']}/product-versions",
            json={"version": "EVT1"},
        ).json()
        saved = client.patch(
            f"/api/product-versions/{version['id']}",
            json={"ai_context": "DO_NOT_BORROW_OTHER_VERSION_CONTEXT"},
        )
        assert saved.status_code == 200, saved.text
        run_id = prepare(client, monkeypatch)
        captured: list[str] = []

        class Adapter:
            def generate(self, **kwargs):
                captured.append(kwargs["evidence_json"])
                return {
                    "diagnosis_status": "completed",
                    "phenomena": [],
                    "possible_causes": [],
                    "impact_scope": [],
                    "retest_recommendations": [],
                    "missing_evidence": [],
                    "uncertainties": [],
                    "limitations": [],
                }

        monkeypatch.setattr(diagnosis_module, "get_provider_adapter", lambda _: Adapter())
        result = client.post(f"/api/runs/{run_id}/diagnoses", json=payload())
        assert result.status_code == 201, result.text
        assert result.json()["status"] == "completed"
        assert len(captured) == 1
        assert "DO_NOT_BORROW_OTHER_VERSION_CONTEXT" not in captured[0]
        assert "ai_context" not in result.json()["config_snapshot"]
