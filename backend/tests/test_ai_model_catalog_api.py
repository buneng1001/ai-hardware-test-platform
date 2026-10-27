import json

from fastapi.testclient import TestClient

from app import settings as settings_module
from app.main import app
from app.siliconflow import ModelErrorKind, SiliconFlowAdapter, SiliconFlowError


def test_adapter_lists_unique_provider_models() -> None:
    def catalog_transport(request):
        assert request["api_key"] == "temporary-secret"
        assert request["endpoint"].endswith("/models")
        return 200, json.dumps(
            {
                "data": [
                    {"id": "model-b"},
                    {"id": "model-a"},
                    {"id": "model-b"},
                    {"name": "missing-id"},
                ]
            }
        )

    models = SiliconFlowAdapter(catalog_transport=catalog_transport).list_models(api_key="temporary-secret")

    assert models == ["model-b", "model-a"]


def test_model_catalog_queries_provider_without_returning_temporary_key(monkeypatch) -> None:
    class FakeAdapter:
        def list_models(self, *, api_key):
            assert api_key == "temporary-secret"
            return ["deepseek-ai/DeepSeek-V4.1-Flash", "zai-org/GLM-5.2"]

    monkeypatch.setattr(settings_module, "get_provider_adapter", lambda _provider: FakeAdapter())

    with TestClient(app) as client:
        response = client.post(
            "/api/settings/ai/models/query",
            json={"provider": "siliconflow", "api_key": "temporary-secret"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "provider": "siliconflow",
        "models": ["deepseek-ai/DeepSeek-V4.1-Flash", "zai-org/GLM-5.2"],
        "source": "provider",
        "warning": None,
    }
    assert "temporary-secret" not in response.text


def test_model_catalog_falls_back_when_api_key_is_not_configured(monkeypatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)

    with TestClient(app) as client:
        response = client.post(
            "/api/settings/ai/models/query",
            json={"provider": "deepseek", "api_key": ""},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "deepseek"
    assert body["source"] == "configured"
    assert body["models"] == ["deepseek-flash", "deepseek-v4-pro"]
    assert "未配置 DeepSeek API Key" in body["warning"]


def test_model_catalog_falls_back_when_provider_query_fails(monkeypatch) -> None:
    class FailingAdapter:
        def list_models(self, *, api_key):
            assert api_key == "temporary-secret"
            raise SiliconFlowError(
                ModelErrorKind.NETWORK,
                "模型目录网络请求失败",
                True,
            )

    monkeypatch.setattr(
        settings_module,
        "get_provider_adapter",
        lambda _provider: FailingAdapter(),
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/settings/ai/models/query",
            json={"provider": "deepseek", "api_key": "temporary-secret"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "configured"
    assert body["models"] == ["deepseek-flash", "deepseek-v4-pro"]
    assert "实时模型目录查询失败" in body["warning"]
    assert "temporary-secret" not in response.text
