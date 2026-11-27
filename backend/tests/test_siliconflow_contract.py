import json
import time
from http.client import RemoteDisconnected

import pytest
from fastapi.testclient import TestClient

from app import ai_provider_core
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


def enable_formal_ai(client, monkeypatch, *, provider="siliconflow", model="demo-model"):
    """Historical real-model contract tests now satisfy T02/T03 admission first."""

    class Verifier:
        def check_connection(self, **_kwargs):
            return None

    monkeypatch.setattr("app.settings.get_provider_adapter", lambda _: Verifier())
    config = client.post(
        "/api/settings/ai/config",
        json={"provider": provider, "model": model, "key_source": "temporary", "network_mode": "auto"},
    )
    assert config.status_code == 200, config.text
    verified = client.post(
        "/api/settings/ai/test",
        json={
            "provider": provider,
            "model": model,
            "key_source": "temporary",
            "network_mode": "auto",
            "api_key": "session-secret",
        },
    )
    assert verified.status_code == 200 and verified.json()["ok"], verified.text
    enabled = client.put("/api/settings/ai/state", json={"enabled": True})
    assert enabled.status_code == 200 and enabled.json()["enabled"], enabled.text


def test_generate_json_classifies_invalid_inner_json_without_exposing_response_body():
    content = '{"summary": "unterminated'
    response = json.dumps({"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})

    adapter = SiliconFlowAdapter(transport=lambda _request: (200, response))

    with pytest.raises(SiliconFlowError) as captured:
        adapter.generate_json(
            api_key="temporary-secret",
            model="demo-model",
            evidence_json="{}",
            system_prompt="只返回 JSON",
            stage="intelligent_regression_global",
        )

    error = captured.value
    assert error.kind == ModelErrorKind.INVALID_RESPONSE
    assert error.stage == "intelligent_regression_global"
    assert error.diagnostic == "content_json_invalid"
    assert error.response_chars == len(content)
    assert content not in str(error)


def test_generate_json_accepts_json_code_fence_with_case_insensitive_language_tag():
    content = " " + chr(96) * 3 + 'JSON\n{"summary":"ok"}\n' + chr(96) * 3 + " "
    response = json.dumps({"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})
    adapter = SiliconFlowAdapter(transport=lambda _request: (200, response))

    result = adapter.generate_json(
        api_key="temporary-secret",
        model="demo-model",
        evidence_json="{}",
        system_prompt="只返回 JSON",
        stage="intelligent_regression_global",
    )

    assert result == {"summary": "ok"}


def test_generate_json_classifies_missing_message_as_invalid_response():
    response = json.dumps({"choices": [{"finish_reason": "stop"}]})
    adapter = SiliconFlowAdapter(transport=lambda _request: (200, response))

    with pytest.raises(SiliconFlowError) as captured:
        adapter.generate_json(
            api_key="temporary-secret",
            model="demo-model",
            evidence_json="{}",
            system_prompt="只返回 JSON",
            stage="intelligent_regression_global",
        )

    assert captured.value.kind == ModelErrorKind.INVALID_RESPONSE
    assert captured.value.diagnostic == "response_message_missing"


def test_adapter_returns_structured_json_from_openai_compatible_response():
    def transport(_request):
        return 200, json.dumps({"choices": [{"message": {"content": '{"diagnosis_status":"completed"}'}}]})

    result = SiliconFlowAdapter(transport=transport).generate(
        api_key="temporary-secret",
        model="demo-model",
        evidence_json="{}",
    )

    assert result == {"diagnosis_status": "completed"}


@pytest.mark.parametrize(
    ("model", "stage", "bounded"),
    [
        ("Qwen/Qwen3.8-27B", "report_analysis", True),
        ("Qwen/Qwen3.8-27B", "report_analysis_repair", True),
        ("Qwen/Qwen3.8-27B", "intelligent_regression_module", False),
        ("Qwen/Qwen3.8-27B", "conversion", False),
        ("demo-model", "report_analysis", False),
    ],
)
def test_report_thinking_budget_is_scoped(model, stage, bounded):
    def transport(request):
        body = request["body"]
        if bounded:
            assert body["enable_thinking"] is True
            assert body["thinking_budget"] == 1024
        else:
            assert "thinking_budget" not in body
        return 200, json.dumps({"choices": [{"message": {"content": "{}"}}]})

    assert (
        SiliconFlowAdapter(transport=transport).generate_json(
            api_key="temporary-secret",
            model=model,
            system_prompt="Return JSON",
            evidence_json="{}",
            stage=stage,
        )
        == {}
    )


def test_qwen_regression_request_streams_without_forcing_thinking():
    def transport(request):
        body = request["body"]
        assert body["stream"] is True
        assert body["max_tokens"] == 8192
        assert "enable_thinking" not in body
        assert "thinking_budget" not in body
        return 200, json.dumps({"choices": [{"message": {"content": "{}"}}]})

    assert (
        SiliconFlowAdapter(transport=transport).generate_json(
            api_key="temporary-secret",
            model="Qwen/Qwen3.8-27B",
            system_prompt="Return JSON",
            evidence_json="{}",
            stage="intelligent_regression_module",
            stream=True,
            max_output_tokens=8192,
        )
        == {}
    )


def test_default_transport_reassembles_sse_and_ignores_reasoning_content(monkeypatch):
    class StreamResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __iter__(self):
            return iter(
                [
                    b'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n',
                    b'data: {"choices":[{"delta":{"content":"{"}}]}\n',
                    b'data: {"choices":[{"delta":{"content":"}"}}]}\n',
                    b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
                    b"data: [DONE]\n",
                ]
            )

    monkeypatch.setattr(ai_provider_core, "_open_url", lambda *_args: StreamResponse())
    adapter = SiliconFlowAdapter()
    progress = []
    result = adapter.generate_json(
        api_key="temporary-secret",
        model="Qwen/Qwen3.8-27B",
        system_prompt="Return JSON",
        evidence_json="{}",
        stage="intelligent_regression_module",
        stream=True,
        max_output_tokens=8192,
        on_stream_progress=lambda chars, events: progress.append((chars, events)),
    )

    assert result == {}
    assert adapter.request_logs[-1]["response_chars"] is not None
    assert progress[-1] == (2, 4)


def test_stream_disconnect_preserves_partial_length_and_is_not_retried(monkeypatch):
    class BrokenStreamResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __iter__(self):
            yield b'data: {"choices":[{"delta":{"content":"{"}}]}\n'
            raise RemoteDisconnected("Remote end closed connection without response")

    monkeypatch.setattr(ai_provider_core, "_open_url", lambda *_args: BrokenStreamResponse())
    adapter = SiliconFlowAdapter()

    progress = []
    with pytest.raises(SiliconFlowError) as captured:
        adapter.generate_json(
            api_key="temporary-secret",
            model="Qwen/Qwen3.8-27B",
            system_prompt="Return JSON",
            evidence_json="{}",
            stage="intelligent_regression_module",
            stream=True,
            max_output_tokens=8192,
            on_stream_progress=lambda chars, events: progress.append((chars, events)),
        )

    assert captured.value.kind == ModelErrorKind.NETWORK
    assert captured.value.retryable is False
    assert captured.value.response_chars > 0
    assert progress[-1] == (1, 1)
    assert adapter.call_count == 1


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

    assert calls == 2


def test_intelligent_regression_does_not_replay_retryable_model_failures():
    calls = 0

    def transport(_request):
        nonlocal calls
        calls += 1
        return 503, "temporarily unavailable"

    with pytest.raises(SiliconFlowError) as captured:
        SiliconFlowAdapter(transport=transport, sleep=lambda _seconds: None).generate_json(
            api_key="temporary-secret",
            model="demo-model",
            system_prompt="Return JSON",
            evidence_json="{}",
            stage="intelligent_regression",
        )

    assert captured.value.retryable is True
    assert captured.value.attempts == 1
    assert calls == 1


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
        enable_formal_ai(client, monkeypatch, provider="kimi", model="moonshot-v1-8k")
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
        enable_formal_ai(client, monkeypatch, provider="siliconflow", model="demo-model")
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
        enable_formal_ai(client, monkeypatch, provider="siliconflow", model="demo-model")
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
