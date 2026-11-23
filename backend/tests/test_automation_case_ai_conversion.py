"""AI 判定式自动化用例转换：只把模型判为 automation 的用例落成候选。"""

import json

import pytest
from fastapi.testclient import TestClient

from app import settings as settings_module
from app.ai_invocation import OCCUPIED_MESSAGE, begin_invocation
from app.main import app


class DecisionAdapter:
    """按用例编号后缀决定判定结果，模拟模型返回结构化输出。"""

    max_calls = 40

    def __init__(self) -> None:
        self.calls = 0

    def generate_json(
        self,
        *,
        api_key: str,
        model: str,
        evidence_json: str,
        system_prompt: str,
        prompt_version: str = "",
        stage: str = "",
    ) -> dict[str, object]:
        self.calls += 1
        cases = json.loads(evidence_json)["cases"]
        items = []
        for case in cases:
            manual = str(case["case_number"]).startswith("MANUAL")
            items.append(
                {
                    "source_case_id": case["source_case_id"],
                    "decision": "manual" if manual else "automation",
                    "reason": "依赖人工观察" if manual else "输入和预期可确定性校验",
                    "title": f"{case['title']}（AI 改写）",
                    "input": case["input"],
                    "steps": case["steps"],
                    "expected_result": case["expected_result"],
                    "confidence": "high" if not manual else "medium",
                }
            )
        return {"items": items}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SILICONFLOW_API_KEY", "test-key")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    class VerificationAdapter:
        def check_connection(self, **_kwargs):
            return None

    monkeypatch.setattr(settings_module, "get_provider_adapter", lambda _provider: VerificationAdapter())
    with TestClient(app) as test_client:
        assert (
            test_client.post(
                "/api/settings/ai/config",
                json={
                    "provider": "deepseek",
                    "model": "deepseek-flash",
                    "key_source": "environment",
                    "network_mode": "auto",
                },
            ).status_code
            == 200
        )
        assert test_client.post(
            "/api/settings/ai/test",
            json={
                "provider": "deepseek",
                "model": "deepseek-flash",
                "key_source": "environment",
            },
        ).json()["ok"]
        assert test_client.put("/api/settings/ai/state", json={"enabled": True}).json()["enabled"]
        yield test_client


def create_version_with_source_cases(client: TestClient) -> int:
    project = client.post(
        "/api/projects",
        json={"name": "IRIS", "product_name": "Recorder", "description": ""},
    ).json()
    version_id = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()["id"]
    imported = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={
            "source_filename": "beta.csv",
            "field_mapping": {
                "case_number": "编号",
                "title": "标题",
                "input": "输入",
                "steps": "步骤",
                "expected_result": "预期",
            },
            "rows": [
                {
                    "编号": "REC-001",
                    "标题": "录制文件完整",
                    "输入": "正常录制数据",
                    "步骤": "开始录制并停止",
                    "预期": "生成完整视频文件",
                },
                {
                    "编号": "MANUAL-002",
                    "标题": "外观检查",
                    "输入": "",
                    "步骤": "目视检查外壳",
                    "预期": "无明显划痕",
                },
            ],
            "import_options": {},
        },
    )
    assert imported.status_code == 201
    return version_id


def test_ai_conversion_only_creates_candidates_for_automation_decisions(client, monkeypatch):
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _provider: adapter)
    version_id = create_version_with_source_cases(client)

    converted = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={})

    assert converted.status_code == 201
    body = converted.json()
    assert body["automation_count"] == 1
    assert body["manual_count"] == 1
    assert body["created_count"] == 1
    assert [item["source_case_number"] for item in body["items"]] == ["REC-001"]
    assert body["items"][0]["title"] == "录制文件完整（AI 改写）"
    manual = [item for item in body["decisions"] if item["decision"] == "manual"][0]
    assert manual["case_number"] == "MANUAL-002"
    assert manual["reason"] == "依赖人工观察"
    # 转人工的用例不应出现在自动化用例表里。
    listed = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]
    assert [item["source_case_number"] for item in listed] == ["REC-001"]


def test_ai_conversion_is_idempotent_for_already_converted_cases(client, monkeypatch):
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _provider: adapter)
    version_id = create_version_with_source_cases(client)

    client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={})
    second = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={})

    assert second.status_code == 201
    assert second.json()["created_count"] == 0
    assert adapter.calls == 1


def test_ai_conversion_requires_configured_key(client, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("SILICONFLOW_API_KEY", raising=False)
    version_id = create_version_with_source_cases(client)

    response = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={})

    assert response.status_code == 400
    assert "AI 模型" in response.json()["detail"]


def test_ai_conversion_rejudges_selected_cases_and_removes_manual_candidates(client, monkeypatch):
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _provider: adapter)
    version_id = create_version_with_source_cases(client)
    # 先跑规则转换：两条都先变成自动化候选，模拟用户已经点过一次旧按钮。
    rules = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules").json()
    assert rules["created_count"] == 2
    ids = [item["id"] for item in client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]]

    converted = client.post(
        f"/api/product-versions/{version_id}/automation-test-case-conversions/ai",
        json={"source_case_ids": ids},
    ).json()

    assert converted["automation_count"] == 1
    assert converted["manual_count"] == 1
    assert converted["created_count"] == 0
    assert converted["updated_count"] == 1
    assert converted["removed_count"] == 1
    listed = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]
    assert [item["source_case_number"] for item in listed] == ["REC-001"]
    case_types = {
        item["case_number"]: item["case_type"]
        for item in client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
    }
    assert case_types == {"REC-001": "automation", "MANUAL-002": "manual"}


def test_unknown_ai_stage_falls_back_to_business_timeout(monkeypatch):
    """新增的转换阶段没有单独超时配置时，按业务请求超时处理而不是抛 KeyError。"""
    from app.ai_provider_core import configured_timeout

    monkeypatch.delenv("AI_BUSINESS_TIMEOUT_SECONDS", raising=False)

    assert configured_timeout("automation_conversion") == 600.0


def test_import_can_use_current_product_version_instead_of_imported_column(client):
    project = client.post("/api/projects", json={"name": "IRIS", "product_name": "Recorder", "description": ""}).json()
    version_id = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT2"}).json()["id"]

    client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={
            "source_filename": "beta.csv",
            "field_mapping": {"case_number": "编号", "title": "标题", "software_version": "版本"},
            "rows": [{"编号": "REC-001", "标题": "录制", "版本": "EVT0"}],
            "import_options": {},
            "software_version_source": "current",
        },
    )

    cases = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
    assert cases[0]["software_version"] == "EVT2"


def test_ai_conversion_mode_all_rejudges_existing_candidates(client, monkeypatch):
    """mode=all 会把已有自动化用例一起重判，判为人工的会被移除。"""
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _provider: adapter)
    version_id = create_version_with_source_cases(client)
    rules = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules").json()
    assert rules["created_count"] == 2

    # 默认 missing 模式此时没有可处理的用例。
    skipped = client.post(
        f"/api/product-versions/{version_id}/automation-test-case-conversions/ai",
        json={"mode": "missing"},
    ).json()
    assert skipped["decisions"] == []

    rejudged = client.post(
        f"/api/product-versions/{version_id}/automation-test-case-conversions/ai",
        json={"mode": "all"},
    ).json()
    assert rejudged["automation_count"] == 1
    assert rejudged["manual_count"] == 1
    assert rejudged["removed_count"] == 1
    listed = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]
    assert [item["source_case_number"] for item in listed] == ["REC-001"]


def test_ai_disabled_rejects_model_but_allows_rules(client, monkeypatch):
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: adapter)
    version_id = create_version_with_source_cases(client)
    assert client.put("/api/settings/ai/state", json={"enabled": False}).status_code == 200
    blocked = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={})
    assert blocked.status_code == 409
    assert adapter.calls == 0
    rules = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules")
    assert rules.status_code == 201
    assert rules.json()["created_count"] == 2


def test_ai_conversion_cancel_keeps_committed_batches_and_discards_late_result(client, monkeypatch):
    from app.ai_batching import BatchConfig
    from app.ai_invocation import get_active_invocation, request_invocation_cancel

    version_id = create_version_with_source_cases(client)
    monkeypatch.setattr("app.automation_conversion_ai.batch_config", lambda: BatchConfig(cases_per_batch=1))

    class CancellingAdapter(DecisionAdapter):
        def generate_json(self, **kwargs):
            if self.calls == 1:
                active = get_active_invocation().active
                assert active is not None
                assert active.operation_type == "automation_conversion"
                request_invocation_cancel(active.invocation_id)
                # Cancel occurs while the second model response is in flight.
            return super().generate_json(**kwargs)

    adapter = CancellingAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: adapter)
    response = client.post(
        f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={"mode": "all"}
    )
    assert response.status_code == 409
    assert "取消" in response.json()["detail"]
    assert adapter.calls == 2
    assert get_active_invocation().active is None
    from app.database import open_database

    with open_database() as connection:
        stored = connection.execute(
            "SELECT ai_decision FROM source_test_cases WHERE product_version_id = ? ORDER BY id",
            (version_id,),
        ).fetchall()
    # First complete batch is durable; second, cancelled batch never writes.
    assert [row["ai_decision"] for row in stored] == ["automation", ""]


def test_ai_conversion_freezes_context_and_fingerprint_between_runs(client, monkeypatch):
    from app.ai_invocation import get_active_invocation

    version_id = create_version_with_source_cases(client)
    assert client.patch(f"/api/product-versions/{version_id}", json={"ai_context": "旧版说明"}).status_code == 200
    fingerprints = []
    contexts = []

    class SnapshotAdapter(DecisionAdapter):
        def generate_json(self, **kwargs):
            evidence = json.loads(kwargs["evidence_json"])
            contexts.append(evidence["ai_context"])
            fingerprints.append(get_active_invocation().active.input_fingerprint)
            if self.calls == 0:
                # Saving a new version context mid-run must not mutate later batches.
                assert (
                    client.patch(f"/api/product-versions/{version_id}", json={"ai_context": "新版说明"}).status_code
                    == 200
                )
            return super().generate_json(**kwargs)

    monkeypatch.setattr(
        "app.automation_conversion_ai.batch_config",
        lambda: __import__("app.ai_batching", fromlist=["BatchConfig"]).BatchConfig(cases_per_batch=1),
    )
    adapter = SnapshotAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: adapter)
    first = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={"mode": "all"})
    assert first.status_code == 201
    assert contexts == ["旧版说明", "旧版说明"]
    assert fingerprints[0] == fingerprints[1]

    second = client.post(
        f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={"mode": "all"}
    )
    assert second.status_code == 201
    assert contexts[2:] == ["新版说明", "新版说明"]
    assert fingerprints[2] != fingerprints[0]


def test_ai_conversion_cross_project_occupancy(client, monkeypatch):
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: adapter)
    version_id = create_version_with_source_cases(client)
    lease = begin_invocation(operation_type="diagnosis", project_id=999)
    try:
        blocked = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={})
        assert blocked.status_code == 409
        assert blocked.json()["detail"] == OCCUPIED_MESSAGE
        assert adapter.calls == 0
    finally:
        lease.finish("completed")


def test_t07_repeat_conversion_requires_confirmation_and_preserves_or_replaces(client, monkeypatch):
    from app.database import open_database

    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: adapter)
    version_id = create_version_with_source_cases(client)
    url = f"/api/product-versions/{version_id}/automation-test-case-conversions/ai"
    first = client.post(url, json={"mode": "all"})
    assert first.status_code == 201, first.text
    before = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]
    assert adapter.calls == 1
    denied = client.post(url, json={"mode": "all"})
    assert denied.status_code == 409 and "完全一致" in denied.json()["detail"]
    assert adapter.calls == 1
    independent = client.post(url, json={"mode": "all", "repeat_confirmed": True})
    assert independent.status_code == 201, independent.text
    assert independent.json()["updated_count"] == 0
    assert client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"] == before
    history = client.get(f"{url}/runs")
    assert history.status_code == 200, history.text
    assert len(history.json()["items"]) == 2
    assert history.json()["items"][0]["decisions"][0]["source_case_id"] > 0
    with open_database() as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM ai_conversion_runs WHERE product_version_id = ? AND is_visible = 1",
                (version_id,),
            ).fetchone()[0]
            == 2
        )
    replaced = client.post(url, json={"mode": "all", "repeat_confirmed": True, "overwrite_previous": True})
    assert replaced.status_code == 201, replaced.text
    assert replaced.json()["updated_count"] == 1
    visible_history = client.get(f"{url}/runs")
    assert visible_history.status_code == 200
    assert len(visible_history.json()["items"]) == 1
    with open_database() as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM ai_conversion_runs WHERE product_version_id = ? AND is_visible = 1",
                (version_id,),
            ).fetchone()[0]
            == 1
        )


def test_t07_failed_second_conversion_batch_keeps_prior_results(client, monkeypatch):
    from app.ai_batching import BatchConfig
    from app.database import open_database

    version_id = create_version_with_source_cases(client)
    url = f"/api/product-versions/{version_id}/automation-test-case-conversions/ai"
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: DecisionAdapter())
    assert client.post(url, json={"mode": "all"}).status_code == 201
    before = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]
    monkeypatch.setattr("app.automation_conversion_ai.batch_config", lambda: BatchConfig(cases_per_batch=1))

    class BrokenSecond(DecisionAdapter):
        def generate_json(self, **kwargs):
            if self.calls == 1:
                raise RuntimeError("simulated second batch outage")
            return super().generate_json(**kwargs)

    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: BrokenSecond())
    with pytest.raises(RuntimeError, match="second batch"):
        client.post(url, json={"mode": "all", "repeat_confirmed": True, "overwrite_previous": True})
    assert client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"] == before
    with open_database() as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM ai_conversion_runs WHERE product_version_id = ? AND is_visible = 1",
                (version_id,),
            ).fetchone()[0]
            == 1
        )

def test_t07_cancelled_repeated_conversion_preserves_prior_results(client, monkeypatch):
    from app.ai_invocation import get_active_invocation, request_invocation_cancel
    from app.database import open_database

    version_id = create_version_with_source_cases(client)
    url = f"/api/product-versions/{version_id}/automation-test-case-conversions/ai"
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: DecisionAdapter())
    assert client.post(url, json={"mode": "all"}).status_code == 201
    prior = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]

    class CancelOnResponse(DecisionAdapter):
        def generate_json(self, **kwargs):
            active = get_active_invocation().active
            assert active is not None
            result = super().generate_json(**kwargs)
            request_invocation_cancel(active.invocation_id)
            return result

    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: CancelOnResponse())
    stopped = client.post(url, json={"mode": "all", "repeat_confirmed": True, "overwrite_previous": True})
    assert stopped.status_code == 409 and "取消" in stopped.json()["detail"]
    assert client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"] == prior
    with open_database() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM ai_conversion_runs WHERE product_version_id = ? AND is_visible = 1",
            (version_id,),
        ).fetchone()[0] == 1


def test_t07_failed_database_save_rolls_back_candidate_overwrite(client, monkeypatch):
    import sqlite3

    from app.database import open_database

    version_id = create_version_with_source_cases(client)
    url = f"/api/product-versions/{version_id}/automation-test-case-conversions/ai"
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _: DecisionAdapter())
    assert client.post(url, json={"mode": "all"}).status_code == 201
    prior = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]
    with open_database() as connection:
        connection.execute(
            """CREATE TRIGGER t07_deny_candidate_update BEFORE UPDATE ON automation_test_cases
               BEGIN SELECT RAISE(ABORT, 'injected database failure'); END"""
        )
    with pytest.raises(sqlite3.DatabaseError, match="injected database failure"):
        client.post(url, json={"mode": "all", "repeat_confirmed": True, "overwrite_previous": True})
    assert client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"] == prior
    assert len(client.get(f"{url}/runs").json()["items"]) == 1
