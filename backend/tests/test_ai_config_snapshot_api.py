import json
import sqlite3
import time

from fastapi.testclient import TestClient

from app import diagnosis as diagnosis_module
from app import settings as settings_module
from app.database import LATEST_SCHEMA_VERSION, migrate_database
from app.main import app
from app.siliconflow import ModelErrorKind, SiliconFlowAdapter, SiliconFlowError


def _save_deepseek_config(client: TestClient, model: str = "deepseek-flash") -> dict:
    response = client.post(
        "/api/settings/ai/config",
        json={
            "provider": "deepseek",
            "model": model,
            "key_source": "environment",
            "network_mode": "auto",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _wait_for_run(client: TestClient, run_id: int) -> dict:
    for _ in range(100):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in {"completed", "failed"}:
            return run
        time.sleep(0.05)
    raise AssertionError("运行未在测试时限内完成")


def test_config_snapshot_persists_and_never_returns_plaintext_key(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    saved = _save_deepseek_config(TestClient(app))
    assert saved["snapshot"]["fingerprint"]
    assert saved["snapshot"]["key_source"] == "environment"
    assert saved["snapshot"]["network_mode"] == "auto"
    assert "api_key" not in json.dumps(saved)

    # 新客户端模拟应用重启，只按快照恢复，不依赖进程内状态。
    restarted = TestClient(app)
    restored = restarted.get("/api/settings/ai/config").json()
    assert restored["snapshot"]["fingerprint"] == saved["snapshot"]["fingerprint"]
    assert restored["snapshot"]["model"] == "deepseek-flash"
    assert restored["verification"]["status"] == "untested"


def test_any_config_change_invalidates_previous_verification(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    class FakeAdapter:
        def generate(self, **_kwargs):
            return {"ok": True}

    monkeypatch.setattr(settings_module, "get_provider_adapter", lambda _provider: FakeAdapter())
    client = TestClient(app)
    _save_deepseek_config(client)
    tested = client.post(
        "/api/settings/ai/test",
        json={
            "provider": "deepseek",
            "model": "deepseek-flash",
            "api_key": "temporary-secret",
            "network_mode": "auto",
        },
    )
    assert tested.status_code == 200, tested.text
    assert client.get("/api/settings/ai/config").json()["verification"]["status"] == "verified"

    changed = client.post(
        "/api/settings/ai/config",
        json={
            "provider": "deepseek",
            "model": "deepseek-flash",
            "key_source": "environment",
            "network_mode": "direct",
        },
    ).json()
    assert changed["verification"]["status"] == "invalidated"
    assert changed["verification"]["message"] == "配置已变更，请重新测试"
    assert "temporary-secret" not in tested.text


def test_catalog_verification_and_selection_are_stored_separately(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    class FakeAdapter:
        def list_models(self, *, api_key):
            assert api_key == "catalog-secret"
            return ["deepseek-flash"]

    monkeypatch.setattr(settings_module, "get_provider_adapter", lambda _provider: FakeAdapter())
    client = TestClient(app)
    _save_deepseek_config(client, "deepseek-v4-pro")

    catalog = client.post(
        "/api/settings/ai/models/query",
        json={"provider": "deepseek", "api_key": "catalog-secret"},
    )
    assert catalog.status_code == 200
    assert catalog.json()["models"] == ["deepseek-flash"]

    state = client.get("/api/settings/ai/config").json()
    assert state["catalog"]["models"] == ["deepseek-flash"]
    assert state["catalog"]["selected_model"] == "deepseek-v4-pro"
    assert state["catalog"]["selected_model_available"] is False
    # 目录变化不静默改选模型。
    assert state["snapshot"]["model"] == "deepseek-v4-pro"
    assert state["verification"]["status"] == "untested"


def test_network_mode_auto_falls_back_only_for_connection_errors():
    calls: list[str] = []

    def transport(request):
        mode = request["network_mode"]
        calls.append(mode)
        if mode == "system_proxy":
            raise SiliconFlowError(ModelErrorKind.NETWORK, "代理连接失败", False)
        return 200, json.dumps({"data": [{"id": "deepseek-flash"}]})

    adapter = SiliconFlowAdapter(network_mode="auto", transport=transport, catalog_transport=transport)
    assert adapter.list_models(api_key="secret") == ["deepseek-flash"]
    assert calls == ["system_proxy", "direct"]
    assert any("回退" in item for item in adapter.network_diagnostics)

    auth_calls: list[str] = []

    def auth_transport(request):
        auth_calls.append(request["network_mode"])
        raise SiliconFlowError(ModelErrorKind.AUTHENTICATION, "鉴权失败", False)

    auth_adapter = SiliconFlowAdapter(network_mode="auto", catalog_transport=auth_transport)
    try:
        auth_adapter.list_models(api_key="secret")
    except SiliconFlowError as error:
        assert error.kind == ModelErrorKind.AUTHENTICATION
    else:
        raise AssertionError("鉴权错误不应回退")
    assert auth_calls == ["system_proxy"]


def test_ai_run_freezes_saved_config_snapshot(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    client = TestClient(app)
    client.__enter__()
    saved = _save_deepseek_config(client)

    class FakeAdapter:
        def generate(self, *, api_key, model, evidence_json):
            return {
                "diagnosis_status": "completed",
                "phenomena": [],
                "possible_causes": [],
                "impact_scope": ["当前窗口"],
                "retest_recommendations": [],
                "missing_evidence": [],
                "uncertainties": [],
                "limitations": [],
            }

    monkeypatch.setattr(diagnosis_module, "SiliconFlowAdapter", FakeAdapter)
    task = client.post(
        "/api/collection-tasks",
        json={"name": "配置快照诊断", "mode": "quick", "scenario": "normal"},
    ).json()
    run = _wait_for_run(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
    diagnosis = client.post(
        f"/api/runs/{run['id']}/diagnoses",
        json={
            "provider": "deepseek",
            "mode": "deepseek",
            "model": "deepseek-flash",
            "api_key": "temporary-secret",
        },
    )
    assert diagnosis.status_code == 201, diagnosis.text
    snapshot = diagnosis.json()["config_snapshot"]
    assert snapshot["fingerprint"] == saved["snapshot"]["fingerprint"]
    assert snapshot["endpoint"].startswith("https://")
    assert snapshot["network_mode"] == "auto"
    assert "temporary-secret" not in diagnosis.text


def test_migration_adds_separate_ai_tables_without_plaintext_key():
    connection = sqlite3.connect(":memory:")
    migrate_database(connection)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == LATEST_SCHEMA_VERSION
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"ai_config_snapshots", "ai_config_selection", "ai_model_catalogs", "ai_verification_runs"} <= tables
    snapshot_columns = {row[1] for row in connection.execute("PRAGMA table_info(ai_config_snapshots)")}
    assert "key_source" in snapshot_columns
    assert "api_key" not in snapshot_columns
    assert "config_snapshot" in {row[1] for row in connection.execute("PRAGMA table_info(diagnosis_runs)")}
