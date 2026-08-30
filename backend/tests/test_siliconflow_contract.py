import json
import time

import pytest
from fastapi.testclient import TestClient

from app import diagnosis as diagnosis_module
from app.main import app
from app.siliconflow import (
    KimiAdapter,
    ModelErrorKind,
    SiliconFlowAdapter,
    SiliconFlowError,
)


def wait_for_completion(client, run_id: int) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "completed":
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 10 秒内完成")


def test_adapter_returns_structured_json_from_openai_compatible_response():
    def transport(_request):
        return 200, json.dumps({"choices": [{"message": {"content": '{"diagnosis_status":"completed"}'}}]})

    result = SiliconFlowAdapter(transport=transport).generate(
        api_key="temporary-secret",
        model="demo-model",
        evidence_json="{}",
    )

    assert result == {"diagnosis_status": "completed"}


def test_connection_check_accepts_normal_model_reply_without_diagnosis_schema():
    def transport(_request):
        return 200, json.dumps({"choices": [{"message": {"content": "连接成功"}}]})

    SiliconFlowAdapter(transport=transport).check_connection(
        api_key="temporary-secret",
        model="demo-model",
    )


def test_kimi_connection_check_omits_unsupported_temperature_parameter():
    def transport(request):
        assert "temperature" not in request["body"]
        return 200, json.dumps({"choices": [{"message": {"content": "连接成功"}}]})

    KimiAdapter(transport=transport).check_connection(
        api_key="temporary-secret",
        model="kimi-k2.6",
    )


@pytest.mark.parametrize(
    ("status", "expected_kind", "retryable"),
    [
        (401, ModelErrorKind.AUTHENTICATION, False),
        (408, ModelErrorKind.TIMEOUT, True),
        (429, ModelErrorKind.RATE_LIMIT, True),
        (500, ModelErrorKind.TEMPORARY_SERVICE, True),
        (400, ModelErrorKind.INVALID_REQUEST, False),
    ],
)
def test_adapter_classifies_http_errors(status, expected_kind, retryable):
    def transport(_request):
        return status, "service-error"

    with pytest.raises(SiliconFlowError) as error:
        SiliconFlowAdapter(transport=transport, sleep=lambda _seconds: None).generate(
            api_key="temporary-secret",
            model="demo-model",
            evidence_json="{}",
        )

    assert error.value.kind == expected_kind
    assert error.value.retryable is retryable


def test_adapter_does_not_retry_general_network_errors():
    calls = 0

    def transport(_request):
        nonlocal calls
        calls += 1
        raise SiliconFlowError(ModelErrorKind.NETWORK, "连接被拒绝", False)

    with pytest.raises(SiliconFlowError):
        SiliconFlowAdapter(transport=transport, sleep=lambda _seconds: None).generate(
            api_key="temporary-secret",
            model="demo-model",
            evidence_json="{}",
        )

    assert calls == 1


def test_adapter_retries_retryable_errors_at_most_twice():
    calls = 0

    def transport(_request):
        nonlocal calls
        calls += 1
        return 503, "temporarily unavailable"

    with pytest.raises(SiliconFlowError):
        SiliconFlowAdapter(transport=transport, sleep=lambda _seconds: None).generate(
            api_key="temporary-secret",
            model="demo-model",
            evidence_json="{}",
        )

    assert calls == 3


def test_settings_api_exposes_configuration_state_without_key_or_mask(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SILICONFLOW_API_KEY", "environment-secret")

    with TestClient(app) as client:
        response = client.get("/api/settings/ai")

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "siliconflow"
    assert body["api_key_configured"] is True
    assert "environment-secret" not in response.text
    assert "***" not in response.text


def test_settings_api_exposes_isolated_provider_catalogs_without_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-secret")
    monkeypatch.setenv("KIMI_API_KEY", "kimi-secret")

    with TestClient(app) as client:
        response = client.get("/api/settings/ai")

    assert response.status_code == 200
    body = response.json()
    providers = {item["provider"]: item for item in body["providers"]}
    assert set(providers) == {"siliconflow", "deepseek", "kimi"}
    assert providers["deepseek"]["api_key_configured"] is True
    assert providers["kimi"]["api_key_configured"] is True
    assert providers["siliconflow"]["api_key_configured"] is False
    assert "deepseek-secret" not in response.text
    assert "kimi-secret" not in response.text


def test_connection_test_reports_provider_and_rejects_unknown_model(monkeypatch):
    calls = []

    class FakeAdapter:
        def __init__(self, provider):
            self.provider = provider

        def generate(self, *, api_key, model, evidence_json):
            calls.append((self.provider, api_key, model, evidence_json))
            return {"ok": True}

    monkeypatch.setattr("app.settings.get_provider_adapter", FakeAdapter)
    with TestClient(app) as client:
        success = client.post(
            "/api/settings/ai/test",
            json={"provider": "deepseek", "model": "deepseek-chat", "api_key": "session-secret"},
        )
        invalid = client.post(
            "/api/settings/ai/test",
            json={"provider": "deepseek", "model": "not-a-supported-model", "api_key": "session-secret"},
        )

    assert success.status_code == 200
    assert success.json()["provider"] == "deepseek"
    assert success.json()["model"] == "deepseek-chat"
    assert calls == [("deepseek", "session-secret", "deepseek-chat", "{}")]
    assert invalid.status_code == 422
    assert "模型" in invalid.json()["detail"]


def test_diagnosis_accepts_allowed_structured_wrapper_and_saves_provider(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    class FakeAdapter:
        def generate(self, **_kwargs):
            return {
                "diagnosis": {
                    "diagnosis_status": "completed",
                    "phenomena": [],
                    "possible_causes": [],
                    "impact_scope": ["当前窗口"],
                    "retest_recommendations": [],
                    "missing_evidence": [],
                    "uncertainties": [],
                    "limitations": [],
                }
            }

    monkeypatch.setattr(diagnosis_module, "get_provider_adapter", lambda _provider: FakeAdapter())
    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks", json={"name": "包装诊断", "mode": "quick", "scenario": "normal"}
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        response = client.post(
            f"/api/runs/{run['id']}/diagnoses",
            json={"provider": "kimi", "mode": "kimi", "model": "moonshot-v1-8k", "api_key": "session-secret"},
        )

    assert response.status_code == 201
    assert response.json()["provider"] == "kimi"
    assert response.json()["output"]["diagnosis_status"] == "completed"


def test_connection_test_accepts_temporary_key_and_never_returns_it(monkeypatch):
    class FakeAdapter:
        def generate(self, *, api_key, model, evidence_json):
            assert api_key == "session-secret"
            assert model == "demo-model"
            assert evidence_json == "{}"
            return {"ok": True}

    monkeypatch.setattr("app.settings.SiliconFlowAdapter", FakeAdapter)
    with TestClient(app) as client:
        response = client.post(
            "/api/settings/ai/test",
            json={"model": "demo-model", "api_key": "session-secret"},
        )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert "session-secret" not in response.text


def test_real_diagnosis_is_saved_separately_and_accepts_structured_output(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    class FakeAdapter:
        def generate(self, *, api_key, model, evidence_json):
            assert api_key == "session-secret"
            assert model == "demo-model"
            assert json.loads(evidence_json)["items"]
            return {
                "diagnosis_status": "completed",
                "phenomena": [{"description": "检测到异常", "evidence_refs": ["E003"]}],
                "possible_causes": [
                    {
                        "cause": "需要进一步复测",
                        "evidence_refs": [],
                        "confidence": "low",
                        "is_speculation": True,
                    }
                ],
                "impact_scope": ["当前窗口"],
                "retest_recommendations": ["保持种子复测"],
                "missing_evidence": [],
                "uncertainties": ["不能证明根因"],
                "limitations": ["真实模型输出需要人工复核"],
            }

    monkeypatch.setattr(diagnosis_module, "SiliconFlowAdapter", FakeAdapter)
    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "真实诊断契约", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        response = client.post(
            f"/api/runs/{run['id']}/diagnoses",
            json={"mode": "siliconflow", "model": "demo-model", "api_key": "session-secret"},
        )
        after = client.get(f"/api/runs/{run['id']}").json()

    assert response.status_code == 201
    assert response.json()["is_mock"] is False
    assert response.json()["status"] == "completed"
    assert after["status"] == "completed"
    assert "session-secret" not in response.text


def test_model_failure_is_saved_without_blocking_original_run(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    class FailingAdapter:
        def generate(self, **_kwargs):
            raise SiliconFlowError(ModelErrorKind.AUTHENTICATION, "模型认证失败", False)

    monkeypatch.setattr(diagnosis_module, "SiliconFlowAdapter", FailingAdapter)
    with TestClient(app) as client:
        task = client.post(
            "/api/collection-tasks",
            json={"name": "降级诊断", "mode": "quick", "scenario": "normal"},
        ).json()
        run = wait_for_completion(client, client.post(f"/api/collection-tasks/{task['id']}/runs").json()["id"])
        response = client.post(
            f"/api/runs/{run['id']}/diagnoses",
            json={"mode": "siliconflow", "api_key": "bad-secret"},
        )
        report = client.get(f"/api/runs/{run['id']}/report").json()

    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert response.json()["output"] is None
    assert response.json()["error"] == "authentication: 模型认证失败"
    assert report["diagnosis"]["status"] == "failed"
    assert report["status"] == "completed"
    assert "bad-secret" not in response.text
