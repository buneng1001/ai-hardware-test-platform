"""T03 唯一活动租约、取消收尾与重启恢复；仅使用真实 SQLite + Mock 验证，无外部模型费用。"""

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import settings as settings_module
from app.ai_invocation import (
    OCCUPIED_MESSAGE,
    AiInvocationCancelled,
    begin_invocation,
    finish_invocation,
    recover_interrupted_invocations,
)
from app.database import LATEST_SCHEMA_VERSION, migrate_database, open_database
from app.main import app


@pytest.fixture
def enabled_ai(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    client = TestClient(app)
    client.post(
        "/api/settings/ai/config",
        json={"provider": "deepseek", "model": "deepseek-flash", "key_source": "environment", "network_mode": "auto"},
    )

    class Adapter:
        def check_connection(self, **_kwargs):
            return None

    monkeypatch.setattr(settings_module, "get_provider_adapter", lambda _provider: Adapter())
    result = client.post(
        "/api/settings/ai/test",
        json={"provider": "deepseek", "model": "deepseek-flash", "key_source": "environment"},
    )
    assert result.status_code == 200 and result.json()["ok"]
    result = client.put("/api/settings/ai/state", json={"enabled": True})
    assert result.status_code == 200 and result.json()["enabled"]
    return client


def test_atomic_cross_project_admission_cancel_and_config_lock(enabled_ai):
    client = enabled_ai
    lease = begin_invocation(operation_type="diagnosis", project_id=1, resource_id=15)
    assert lease.config_snapshot["model"] == "deepseek-flash"
    assert client.get("/api/settings/ai/active-invocation").json()["active"]["operation_type"] == "diagnosis"
    assert client.get("/api/settings/ai/active-invocation").json()["active"]["project_id"] == 1

    with pytest.raises(HTTPException, match=OCCUPIED_MESSAGE):
        begin_invocation(operation_type="report_analysis", project_id=2, resource_id=200)
    config = client.post(
        "/api/settings/ai/config",
        json={"provider": "deepseek", "model": "deepseek-flash", "key_source": "environment", "network_mode": "auto"},
    )
    assert config.status_code == 409
    assert client.put("/api/settings/ai/state", json={"enabled": False}).status_code == 409
    assert client.get("/api/settings/ai/state").json()["enabled"]

    cancelled = client.post(f"/api/settings/ai/invocations/{lease.invocation_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["stopping"] is True
    assert client.post(f"/api/settings/ai/invocations/{lease.invocation_id}/cancel").status_code == 200
    assert lease.cancel_requested()
    assert client.put("/api/settings/ai/state", json={"enabled": False}).status_code == 409
    with pytest.raises(HTTPException, match=OCCUPIED_MESSAGE):
        begin_invocation(operation_type="automation_conversion", project_id=3)

    # 真实业务提交之前必须重新检查取消意图，且与结果写入处于同一写事务。
    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        with pytest.raises(AiInvocationCancelled):
            lease.assert_can_commit(connection)
    assert lease.finish("completed") == "cancelled"
    assert lease.finish("completed") == "cancelled"
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None
    assert client.post(f"/api/settings/ai/invocations/{lease.invocation_id}/cancel").status_code == 404

    other = begin_invocation(operation_type="automation_conversion", project_id=3)
    with pytest.raises(AiInvocationCancelled):
        finish_invocation(lease.invocation_id, status="completed")
    assert other.finish("failed") == "failed"
    assert client.put("/api/settings/ai/state", json={"enabled": False}).json()["enabled"] is False
    with pytest.raises(HTTPException, match="全局 AI 已关闭"):
        begin_invocation(operation_type="diagnosis")


def test_parallel_start_allows_one_and_no_queue(enabled_ai):
    barrier = threading.Barrier(8)

    def start(index):
        barrier.wait(timeout=10)
        try:
            lease = begin_invocation(operation_type="diagnosis", project_id=index + 1)
            return lease
        except HTTPException as error:
            assert error.status_code == 409
            assert error.detail == OCCUPIED_MESSAGE
            return None

    with ThreadPoolExecutor(max_workers=8) as executor:
        leases = list(executor.map(start, range(8)))
    winners = [lease for lease in leases if lease is not None]
    assert len(winners) == 1
    assert winners[0].finish("completed") == "completed"


def test_cancel_while_transport_blocked_keeps_lease_and_discards_late_result(enabled_ai):
    client = enabled_ai
    entered = threading.Event()
    release = threading.Event()
    results = []

    def blocked_transport():
        lease = begin_invocation(operation_type="report_analysis", project_id=2)
        entered.set()
        assert release.wait(timeout=10)
        if lease.cancel_requested():
            results.append("discarded")
        else:
            with open_database() as connection:
                connection.execute("BEGIN IMMEDIATE")
                lease.assert_can_commit(connection)
                results.append("saved")
        results.append(lease.finish("completed"))

    worker = threading.Thread(target=blocked_transport)
    worker.start()
    try:
        assert entered.wait(timeout=10)
        active = client.get("/api/settings/ai/active-invocation").json()["active"]
        assert client.post(f"/api/settings/ai/invocations/{active['invocation_id']}/cancel").status_code == 200
        assert client.get("/api/settings/ai/active-invocation").json()["active"]["stopping"]
        with pytest.raises(HTTPException, match=OCCUPIED_MESSAGE):
            begin_invocation(operation_type="diagnosis", project_id=99)
        assert (
            client.post(
                "/api/settings/ai/config",
                json={"provider": "deepseek", "model": "deepseek-flash"},
            ).status_code
            == 409
        )
        assert results == []
    finally:
        release.set()
        worker.join(timeout=10)
    assert not worker.is_alive()
    assert results == ["discarded", "cancelled"]


def test_restart_marks_running_interrupted_not_auto_resumed(enabled_ai):
    client = enabled_ai
    lease = begin_invocation(operation_type="intelligent_regression", project_id=5)
    assert recover_interrupted_invocations() == 1
    assert recover_interrupted_invocations() == 0
    assert client.get("/api/settings/ai/state").json()["enabled"] is True
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None
    with open_database() as connection:
        row = connection.execute("SELECT status FROM ai_active_invocation").fetchone()
        assert row["status"] == "interrupted"
        connection.execute("BEGIN IMMEDIATE")
        with pytest.raises(AiInvocationCancelled):
            lease.assert_can_commit(connection)
    next_lease = begin_invocation(operation_type="diagnosis")
    assert next_lease.invocation_id != lease.invocation_id
    assert next_lease.finish("completed") == "completed"


def test_migration_legacy_data_and_redacted_summary(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    db = tmp_path / "platform.sqlite3"
    connection = sqlite3.connect(db)
    migrate_database(connection)
    connection.execute("CREATE TABLE IF NOT EXISTS t03_old_data (value TEXT NOT NULL)")
    connection.execute("INSERT INTO t03_old_data VALUES ('keep-me')")
    connection.commit()
    connection.close()
    with open_database() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == LATEST_SCHEMA_VERSION
        assert conn.execute("SELECT value FROM t03_old_data").fetchone()["value"] == "keep-me"
        assert conn.execute("SELECT COUNT(*) FROM ai_active_invocation").fetchone()[0] == 0


def test_business_commit_and_cancel_are_serialized(enabled_ai):
    client = enabled_ai
    lease = begin_invocation(operation_type="diagnosis")
    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        lease.assert_can_commit(connection)

        # 异步取消必须在这笔业务写入事务结束后才能获取写锁。
        def cancel():
            return client.post(f"/api/settings/ai/invocations/{lease.invocation_id}/cancel")

        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(cancel)
            assert not pending.done()
            connection.commit()
            assert pending.result(timeout=10).status_code == 200
    assert lease.cancel_requested()
    assert lease.finish("completed") == "cancelled"


def test_stop_and_disable_keeps_invocation_lock_until_local_finish(enabled_ai):
    client = enabled_ai
    lease = begin_invocation(operation_type="report_analysis", project_id=7)

    requested = client.post(f"/api/settings/ai/invocations/{lease.invocation_id}/stop-and-disable")
    assert requested.status_code == 200, requested.text
    assert requested.json()["enabled"] is True
    assert requested.json()["active"]["stopping"] is True

    # 取消收尾未完成时，AI 仍显示开启且业务/正式配置均持续被锁定。
    assert client.get("/api/settings/ai/state").json()["enabled"] is True
    assert client.get("/api/settings/ai/active-invocation").json()["active"]["invocation_id"] == lease.invocation_id
    assert (
        client.post(
            "/api/settings/ai/config",
            json={"provider": "deepseek", "model": "deepseek-v4-pro", "key_source": "environment"},
        ).status_code
        == 409
    )
    with pytest.raises(HTTPException, match=OCCUPIED_MESSAGE):
        begin_invocation(operation_type="diagnosis")

    assert lease.cancel_requested()
    assert lease.finish("completed") == "cancelled"
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None
    assert client.get("/api/settings/ai/state").json()["enabled"] is False
    with pytest.raises(HTTPException, match="全局 AI 已关闭"):
        begin_invocation(operation_type="diagnosis")


def test_stop_and_disable_is_idempotent_for_same_invocation(enabled_ai):
    client = enabled_ai
    lease = begin_invocation(operation_type="diagnosis")
    first = client.post(f"/api/settings/ai/invocations/{lease.invocation_id}/stop-and-disable")
    second = client.post(f"/api/settings/ai/invocations/{lease.invocation_id}/stop-and-disable")
    assert first.status_code == second.status_code == 200
    assert lease.finish("failed") == "cancelled"
    assert client.get("/api/settings/ai/state").json()["enabled"] is False
