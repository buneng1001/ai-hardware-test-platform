"""T02 全局开关的真实 SQLite/API 验收，不触发外部模型请求。"""

import sqlite3

from fastapi.testclient import TestClient

from app import settings as settings_module
from app.database import LATEST_SCHEMA_VERSION, migrate_database
from app.main import app


def test_global_ai_state_admission_persistence_and_invalidation(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    client = TestClient(app)
    endpoint = "/api/settings/ai/state"
    assert client.get(endpoint).json()["enabled"] is False
    assert client.put(endpoint, json={"enabled": True}).status_code == 409

    config = {
        "provider": "deepseek",
        "model": "deepseek-flash",
        "key_source": "environment",
        "network_mode": "auto",
    }
    assert client.post("/api/settings/ai/config", json=config).status_code == 200
    assert client.put(endpoint, json={"enabled": True}).status_code == 409

    class FakeAdapter:
        def check_connection(self, **_kwargs):
            return None

    monkeypatch.setattr(settings_module, "get_provider_adapter", lambda _provider: FakeAdapter())
    tested = client.post(
        "/api/settings/ai/test",
        json={"provider": "deepseek", "model": "deepseek-flash", "key_source": "environment"},
    )
    assert tested.json()["ok"] is True
    opened = client.put(endpoint, json={"enabled": True})
    assert opened.status_code == 200, opened.text
    assert opened.json()["enabled"] is True
    assert opened.json()["provider"] == "deepseek"
    assert opened.json()["model"] == "deepseek-flash"
    assert TestClient(app).get(endpoint).json()["enabled"] is True

    # 独立测试不同配置失败不影响正式开关。
    def failed_adapter(_provider):
        from app.siliconflow import ModelErrorKind, SiliconFlowError

        class Adapter:
            def check_connection(self, **_kwargs):
                raise SiliconFlowError(ModelErrorKind.AUTHENTICATION, "独立验证失败", False)

        return Adapter()

    monkeypatch.setattr(settings_module, "get_provider_adapter", failed_adapter)
    failure = client.post(
        "/api/settings/ai/test",
        json={"provider": "deepseek", "model": "deepseek-v4-pro", "key_source": "environment"},
    )
    assert failure.json()["ok"] is False
    assert client.get(endpoint).json()["enabled"] is True

    # 同一正式模型的独立连接测试失败也不得擅自改动用户设置的开关。
    failure = client.post(
        "/api/settings/ai/test",
        json={"provider": "deepseek", "model": "deepseek-flash", "key_source": "environment"},
    )
    assert failure.json()["ok"] is False
    invalidated = client.get(endpoint).json()
    assert invalidated["enabled"] is True
    assert invalidated["can_enable"] is False
    assert client.put(endpoint, json={"enabled": True}).status_code == 409

    # 相同正式选择不得误关闭，真正换模型/参数才关闭。
    client.post("/api/settings/ai/config", json=config)
    assert client.get(endpoint).json()["enabled"] is True
    client.post("/api/settings/ai/config", json={**config, "network_mode": "direct"})
    assert client.get(endpoint).json()["enabled"] is False
    assert client.put(endpoint, json={"enabled": True}).status_code == 409
    assert client.put(endpoint, json={"enabled": False}).json()["enabled"] is False


def test_global_state_migration_keeps_legacy_data():
    connection = sqlite3.connect(":memory:")
    migrate_database(connection)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == LATEST_SCHEMA_VERSION
    connection.execute("UPDATE ai_global_state SET enabled = 1 WHERE id = 1")
    migrate_database(connection)
    assert connection.execute("SELECT enabled FROM ai_global_state").fetchone()[0] == 1
