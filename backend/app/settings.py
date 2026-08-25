"""本地 AI 配置 API；API Key 仅从环境变量或请求内存读取，不落盘。"""

import os
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.siliconflow import SiliconFlowAdapter, SiliconFlowError

router = APIRouter(prefix="/api/settings", tags=["settings"])


class AiSettings(BaseModel):
    provider: Literal["siliconflow"] = "siliconflow"
    model: str = Field(min_length=1, max_length=200)
    mode: Literal["mock", "siliconflow"]
    api_key_configured: bool


class ConnectionTestRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)
    api_key: str = ""


class ConnectionTestResponse(BaseModel):
    ok: bool
    provider: Literal["siliconflow"] = "siliconflow"
    model: str
    error_kind: str | None = None
    message: str


def configured_api_key() -> str:
    return os.getenv("SILICONFLOW_API_KEY", "")


def current_settings() -> AiSettings:
    mode = os.getenv("AI_DIAGNOSIS_MODE", "mock")
    if mode not in {"mock", "siliconflow"}:
        mode = "mock"
    return AiSettings(
        model=os.getenv("SILICONFLOW_MODEL", "Qwen/Qwen2.5-72B-Instruct"),
        mode=mode,
        api_key_configured=bool(configured_api_key()),
    )


@router.get("/ai", response_model=AiSettings)
def get_ai_settings() -> AiSettings:
    return current_settings()


@router.post("/ai/test", response_model=ConnectionTestResponse)
def test_ai_connection(request: ConnectionTestRequest) -> ConnectionTestResponse:
    try:
        SiliconFlowAdapter().generate(
            api_key=request.api_key or configured_api_key(),
            model=request.model,
            evidence_json="{}",
        )
    except SiliconFlowError as error:
        return ConnectionTestResponse(
            ok=False,
            model=request.model,
            error_kind=error.kind,
            message=str(error),
        )
    return ConnectionTestResponse(ok=True, model=request.model, message="硅基流动连接可用")
