"""本地 AI 配置 API；API Key 仅从环境变量或请求内存读取，不落盘。"""

import os
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.ai_config import save_model_catalog, save_selection, save_verification
from app.database import open_database
from app.siliconflow import DeepSeekAdapter, KimiAdapter, SiliconFlowAdapter, SiliconFlowError

router = APIRouter(prefix="/api/settings", tags=["settings"])


class AiSettings(BaseModel):
    provider: Literal["siliconflow", "deepseek", "kimi"] = "siliconflow"
    model: str = Field(min_length=1, max_length=200)
    mode: Literal["mock", "siliconflow", "deepseek", "kimi"]
    api_key_configured: bool
    providers: list[dict[str, object]]


class ConnectionTestRequest(BaseModel):
    provider: Literal["siliconflow", "deepseek", "kimi"] = "siliconflow"
    model: str = Field(min_length=1, max_length=200)
    api_key: str = ""
    key_source: Literal["environment", "temporary"] = "environment"
    network_mode: Literal["auto", "system_proxy", "direct"] = "auto"


class ConnectionTestResponse(BaseModel):
    ok: bool
    provider: Literal["siliconflow", "deepseek", "kimi"]
    model: str
    error_kind: str | None = None
    retryable: bool = False
    message: str
    config_fingerprint: str | None = None
    network_diagnostic: str | None = None


class ModelCatalogQuery(BaseModel):
    provider: Literal["siliconflow", "deepseek", "kimi"]
    api_key: str = ""
    network_mode: Literal["auto", "system_proxy", "direct"] = "auto"


class ModelCatalogResponse(BaseModel):
    provider: Literal["siliconflow", "deepseek", "kimi"]
    models: list[str]
    source: Literal["provider", "configured"]
    warning: str | None = None


PROVIDER_MODELS: dict[str, tuple[str, ...]] = {
    "siliconflow": (
        "zai-org/GLM-5.2",
        "Pro/zai-org/GLM-5.1",
        "zai-org/GLM-5V-Turbo",
        "Pro/moonshotai/Kimi-K3",
        "Pro/moonshotai/Kimi-K2.8-Preview",
        "Pro/moonshotai/Kimi-K2.7",
        "MiniMaxAI/MiniMax-M3.1-Flash",
        "MiniMaxAI/MiniMax-M3",
        "deepseek-ai/DeepSeek-V4.1-Flash",
        "deepseek-ai/DeepSeek-V4-Pro",
        "Qwen/Qwen3.6-27B",
        "Qwen/Qwen3.5-27B",
        "Qwen/Qwen3-8B",
    ),
    "deepseek": ("deepseek-flash", "deepseek-v4-pro"),
    "kimi": ("kimi-k2.6", "kimi-k2.5", "kimi-k2.7-code"),
}
LEGACY_MODEL_ALIASES = {
    "deepseek": ("deepseek-chat", "deepseek-reasoner"),
    "kimi": ("moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"),
}
PROVIDER_ENV_KEYS = {"siliconflow": "SILICONFLOW_API_KEY", "deepseek": "DEEPSEEK_API_KEY", "kimi": "KIMI_API_KEY"}
PROVIDER_ENDPOINT_ENV_KEYS = {
    "siliconflow": "SILICONFLOW_ENDPOINT",
    "deepseek": "DEEPSEEK_ENDPOINT",
    "kimi": "KIMI_ENDPOINT",
}
PROVIDER_ADAPTERS = {"siliconflow": SiliconFlowAdapter, "deepseek": DeepSeekAdapter, "kimi": KimiAdapter}
DEFAULT_MODELS = {
    "siliconflow": "deepseek-ai/DeepSeek-V4.1-Flash",
    "deepseek": PROVIDER_MODELS["deepseek"][0],
    "kimi": PROVIDER_MODELS["kimi"][0],
}


def configured_api_key(provider: str = "siliconflow") -> str:
    return os.getenv(PROVIDER_ENV_KEYS[provider], "")


def get_provider_adapter(provider: str):
    # 硅基流动类名是 RC1 的测试 seam，动态读取可兼容已有注入方式。
    endpoint = os.getenv(PROVIDER_ENDPOINT_ENV_KEYS[provider]) or None
    if provider == "siliconflow":
        return SiliconFlowAdapter(endpoint=endpoint) if endpoint else SiliconFlowAdapter()
    adapter = PROVIDER_ADAPTERS[provider]
    return adapter(endpoint=endpoint) if endpoint else adapter()


def provider_catalog() -> list[dict[str, object]]:
    return [
        {
            "provider": provider,
            "models": list(models),
            "api_key_configured": bool(configured_api_key(provider)),
        }
        for provider, models in PROVIDER_MODELS.items()
    ]


def validate_model(provider: str, model: str) -> None:
    """拒绝把一个服务商的推荐模型静默发送到另一家；custom/ 用于明确的自定义模型。"""
    supported_models = (*PROVIDER_MODELS[provider], *LEGACY_MODEL_ALIASES.get(provider, ()))
    provider_model_shape = {
        "siliconflow": "/" in model,
        "deepseek": model.startswith("deepseek-"),
        "kimi": model.startswith(("kimi-", "moonshot-")),
    }[provider]
    if model not in supported_models and not provider_model_shape and not model.startswith(("custom/", "demo-")):
        raise HTTPException(status_code=422, detail=f"{provider} 不支持模型：{model}")


def current_settings() -> AiSettings:
    mode = os.getenv("AI_DIAGNOSIS_MODE", "mock")
    if mode not in {"mock", *PROVIDER_MODELS}:
        mode = "mock"
    provider = mode if mode != "mock" else "siliconflow"
    return AiSettings(
        provider=provider,
        model=os.getenv(
            f"{provider.upper()}_MODEL",
            DEFAULT_MODELS[provider],
        ),
        mode=mode,
        api_key_configured=bool(configured_api_key(provider)),
        providers=provider_catalog(),
    )


@router.get("/ai", response_model=AiSettings)
def get_ai_settings() -> AiSettings:
    return current_settings()


@router.post("/ai/models/query", response_model=ModelCatalogResponse)
def query_ai_models(request: ModelCatalogQuery) -> ModelCatalogResponse:
    api_key = request.api_key or configured_api_key(request.provider)
    if not api_key:
        provider_label = {"siliconflow": "SiliconFlow", "deepseek": "DeepSeek", "kimi": "Kimi"}[request.provider]
        models = list(PROVIDER_MODELS[request.provider])
        warning = f"未配置 {provider_label} API Key，当前显示内置候选目录。"
        with open_database() as connection:
            save_model_catalog(
                connection,
                provider=request.provider,
                models=models,
                source="configured",
                warning=warning,
            )
        return ModelCatalogResponse(
            provider=request.provider,
            models=models,
            source="configured",
            warning=warning,
        )
    adapter = get_provider_adapter(request.provider)
    if hasattr(adapter, "network_mode"):
        adapter.network_mode = request.network_mode
    try:
        models = adapter.list_models(api_key=api_key)
        source: Literal["provider", "configured"] = "provider"
        warning = None
    except SiliconFlowError as error:
        models = list(PROVIDER_MODELS[request.provider])
        source = "configured"
        warning = f"实时模型目录查询失败：{error}"
    diagnostic = "；".join(getattr(adapter, "network_diagnostics", [])) or None
    if diagnostic:
        warning = f"{warning}（{diagnostic}）" if warning else diagnostic
    with open_database() as connection:
        save_model_catalog(
            connection,
            provider=request.provider,
            models=models,
            source=source,
            warning=warning,
        )
    return ModelCatalogResponse(
        provider=request.provider,
        models=models,
        source=source,
        warning=warning,
    )


@router.post(
    "/ai/test",
    response_model=ConnectionTestResponse,
    response_model_exclude_none=True,
)
def test_ai_connection(request: ConnectionTestRequest) -> ConnectionTestResponse:
    validate_model(request.provider, request.model)
    with open_database() as connection:
        snapshot = save_selection(
            connection,
            provider=request.provider,
            model=request.model,
            key_source=request.key_source,
            network_mode=request.network_mode,
            prompt_version="diagnosis-v1",
        )
    adapter = get_provider_adapter(request.provider)
    if hasattr(adapter, "network_mode"):
        adapter.network_mode = request.network_mode
    try:
        # 兼容旧测试替身；真实适配器使用专用连接检查，避免要求完整诊断结构。
        checker = getattr(adapter, "check_connection", None)
        if checker is not None:
            checker(api_key=request.api_key or configured_api_key(request.provider), model=request.model)
        else:
            adapter.generate(
                api_key=request.api_key or configured_api_key(request.provider),
                model=request.model,
                evidence_json="{}",
            )
    except SiliconFlowError as error:
        diagnostic = "；".join(getattr(adapter, "network_diagnostics", [])) or None
        with open_database() as connection:
            save_verification(
                connection,
                snapshot_id=snapshot["id"],
                status="failed",
                message=str(error),
                error_kind=error.kind,
                retryable=error.retryable,
                network_diagnostic=diagnostic,
            )
        return ConnectionTestResponse(
            ok=False,
            provider=request.provider,
            model=request.model,
            error_kind=error.kind,
            retryable=error.retryable,
            message=str(error),
            config_fingerprint=snapshot["fingerprint"],
            network_diagnostic=diagnostic,
        )
    diagnostic = "；".join(getattr(adapter, "network_diagnostics", [])) or None
    with open_database() as connection:
        save_verification(
            connection,
            snapshot_id=snapshot["id"],
            status="verified",
            message=f"{request.provider} 连接可用",
            error_kind=None,
            retryable=False,
            network_diagnostic=diagnostic,
        )
    return ConnectionTestResponse(
        ok=True,
        provider=request.provider,
        model=request.model,
        message=f"{request.provider} 连接可用",
        config_fingerprint=snapshot["fingerprint"],
        network_diagnostic=diagnostic,
    )
