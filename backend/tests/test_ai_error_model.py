import json
import socket
import ssl

import pytest
from fastapi.testclient import TestClient

from app import settings as settings_module
from app.ai_config import open_database
from app.main import app
from app.siliconflow import (
    ModelErrorKind,
    SiliconFlowAdapter,
    SiliconFlowError,
    _network_error_kind,
    configured_timeout,
)


def _adapter(transport, **kwargs):
    return SiliconFlowAdapter(
        transport=transport,
        catalog_transport=transport,
        sleep=kwargs.pop("sleep", lambda _seconds: None),
        **kwargs,
    )


@pytest.mark.parametrize(
    ("status", "kind", "retryable"),
    [
        (401, ModelErrorKind.AUTHENTICATION, False),
        (403, ModelErrorKind.PERMISSION, False),
        (404, ModelErrorKind.INVALID_MODEL, False),
        (408, ModelErrorKind.TIMEOUT, True),
        (429, ModelErrorKind.RATE_LIMIT, True),
        (500, ModelErrorKind.TEMPORARY_SERVICE, True),
        (400, ModelErrorKind.INVALID_REQUEST, False),
    ],
)
def test_http_errors_have_structured_kind_and_action(status, kind, retryable):
    calls = 0

    def transport(_request):
        nonlocal calls
        calls += 1
        return status, "provider error"

    with pytest.raises(SiliconFlowError) as captured:
        _adapter(transport).generate(api_key="secret-key", model="demo-model", evidence_json="{}")
    error = captured.value
    assert error.kind == kind
    assert error.retryable is retryable
    assert error.stage == "business"
    detail = error.to_dict()
    assert detail["user_message"]
    assert detail["action"]
    assert detail["retryable"] is retryable
    assert calls == (2 if retryable else 1)
    assert "secret-key" not in json.dumps(detail)
    assert "provider error" not in json.dumps(detail)


def test_network_errors_distinguish_dns_tls_proxy_and_connection():
    assert _network_error_kind(socket.gaierror("name resolution failed")) == ModelErrorKind.DNS
    assert _network_error_kind(ssl.SSLError("certificate verify failed")) == ModelErrorKind.TLS
    assert _network_error_kind("proxy tunnel failed") == ModelErrorKind.PROXY
    assert _network_error_kind("connection refused") == ModelErrorKind.CONNECTION


def test_layered_timeouts_are_configurable_per_stage(monkeypatch):
    monkeypatch.setenv("AI_CATALOG_TIMEOUT_SECONDS", "1.5")
    monkeypatch.setenv("AI_CONNECTION_TIMEOUT_SECONDS", "2.5")
    monkeypatch.setenv("AI_BUSINESS_TIMEOUT_SECONDS", "3.5")
    timeouts: list[float] = []

    def transport(request):
        timeouts.append(float(request["timeout"]))
        if request["endpoint"].endswith("/models"):
            return 200, json.dumps({"data": [{"id": "demo-model"}]})
        return 200, json.dumps({"choices": [{"message": {"content": json.dumps({"diagnosis_status": "completed"})}}]})

    adapter = _adapter(transport)
    adapter.list_models(api_key="secret")
    adapter.check_connection(api_key="secret", model="demo-model")
    adapter.generate(api_key="secret", model="demo-model", evidence_json="{}")
    assert timeouts == [1.5, 2.5, 3.5]
    assert configured_timeout("catalog") == 1.5


def test_retry_is_bounded_and_cancelable():
    sleeps: list[float] = []
    calls = 0

    def transport(_request):
        nonlocal calls
        calls += 1
        return 503, "unavailable"

    with pytest.raises(SiliconFlowError):
        _adapter(transport, sleep=sleeps.append).generate(api_key="secret", model="demo-model", evidence_json="{}")
    assert calls == 2
    assert sleeps == [1.0]

    canceled_calls = 0

    def canceled_transport(_request):
        nonlocal canceled_calls
        canceled_calls += 1
        raise SiliconFlowError(ModelErrorKind.TIMEOUT, "请求超时", True)

    canceled = _adapter(canceled_transport, cancel_event=lambda: canceled_calls > 0)
    with pytest.raises(SiliconFlowError):
        canceled.generate(api_key="secret", model="demo-model", evidence_json="{}")
    assert canceled_calls == 1


def test_request_logs_are_persisted_without_secrets_or_bodies(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    def catalog_transport(request):
        assert "secret-key" in request["api_key"]
        return 200, json.dumps({"data": [{"id": "demo-model"}]})

    adapter = _adapter(catalog_transport)
    monkeypatch.setattr(settings_module, "get_provider_adapter", lambda _provider: adapter)
    client = TestClient(app)
    response = client.post(
        "/api/settings/ai/models/query",
        json={"provider": "deepseek", "api_key": "secret-key"},
    )
    assert response.status_code == 200
    assert "secret-key" not in response.text

    with open_database() as connection:
        rows = connection.execute("SELECT * FROM ai_request_logs").fetchall()
    assert rows
    row = rows[-1]
    assert row["stage"] == "catalog"
    assert row["provider"] == "siliconflow"
    assert row["endpoint_host"]
    assert row["attempt"] == 1
    serialized = json.dumps([dict(item) for item in rows], ensure_ascii=False)
    assert "secret-key" not in serialized
    assert "Authorization" not in serialized


def test_verification_failure_persists_structured_error_without_key(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    class FakeAdapter:
        network_diagnostics: list[str] = []
        request_logs: list[dict[str, object]] = []

        def generate(self, **_kwargs):
            raise SiliconFlowError(ModelErrorKind.AUTHENTICATION, "鉴权失败", False)

    monkeypatch.setattr(settings_module, "get_provider_adapter", lambda _provider: FakeAdapter())
    client = TestClient(app)
    client.post(
        "/api/settings/ai/config",
        json={"provider": "deepseek", "model": "deepseek-flash"},
    )
    response = client.post(
        "/api/settings/ai/test",
        json={"provider": "deepseek", "model": "deepseek-flash", "api_key": "secret-key"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["kind"] == "authentication"
    assert body["error"]["action"]
    assert "secret-key" not in response.text

    with open_database() as connection:
        row = connection.execute("SELECT * FROM ai_verification_runs ORDER BY id DESC").fetchone()
    detail = json.loads(row["error_detail"])
    assert detail["kind"] == "authentication"
    assert "secret-key" not in row["error_detail"]
    assert "secret-key" not in row["message"]


def test_output_truncation_is_classified_without_retry():
    calls = 0

    def transport(_request):
        nonlocal calls
        calls += 1
        return 200, json.dumps(
            {
                "choices": [
                    {
                        "finish_reason": "length",
                        "message": {"content": '{"diagnosis_status": "completed"}'},
                    }
                ]
            }
        )

    with pytest.raises(SiliconFlowError) as captured:
        _adapter(transport).generate(api_key="secret", model="demo-model", evidence_json="{}")
    assert captured.value.kind == ModelErrorKind.OUTPUT_TRUNCATED
    assert calls == 1
