"""本地 AI 配置 API；API Key 仅从环境变量或请求内存读取，不落盘。"""

import os
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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


class ConnectionTestResponse(BaseModel):
    ok: bool
    provider: Literal["siliconflow", "deepseek", "kimi"]
    model: str
    error_kind: str | None = None
    retryable: bool = False
    message: str


PROVIDER_MODELS: dict[str, tuple[str, ...]] = {
    "siliconflow": (
        "zai-org/GLM-5.2",
        "zai-org/GLM-4.5V",
        "Pro/moonshotai/Kimi-K2.6",
        "MiniMaxAI/MiniMax-M2.5",
        "deepseek-ai/DeepSeek-V3.2",
        "Qwen/Qwen3.6-27B",
        "Qwen/Qwen3.5-27B",
        "Qwen/Qwen3-8B",
        "Qwen/Qwen2.5-72B-Instruct",
    ),
    "deepseek": ("deepseek-v4-flash", "deepseek-v4-pro"),
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
    "siliconflow": "Qwen/Qwen2.5-72B-Instruct",
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
    if model not in supported_models and not model.startswith(("custom/", "demo-")):
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


@router.post("/ai/test", response_model=ConnectionTestResponse)
def test_ai_connection(request: ConnectionTestRequest) -> ConnectionTestResponse:
    validate_model(request.provider, request.model)
    try:
        adapter = get_provider_adapter(request.provider)
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
        return ConnectionTestResponse(
            ok=False,
            provider=request.provider,
            model=request.model,
            error_kind=error.kind,
            retryable=error.retryable,
            message=str(error),
        )
    return ConnectionTestResponse(
        ok=True,
        provider=request.provider,
        model=request.model,
        message=f"{request.provider} 连接可用",
    )
