"""多服务商 OpenAI 兼容适配层：只返回结构化 JSON，不把密钥带入业务数据。"""

import json
import os
import socket
import ssl
from collections.abc import Callable
from enum import StrEnum
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import ProxyHandler, Request, build_opener


class ModelErrorKind(StrEnum):
    TIMEOUT = "timeout"
    RATE_LIMIT = "rate_limit"
    TEMPORARY_SERVICE = "temporary_service"
    AUTHENTICATION = "authentication"
    PERMISSION = "permission"
    INVALID_REQUEST = "invalid_request"
    INVALID_MODEL = "invalid_model"
    INVALID_RESPONSE = "invalid_response"
    MALFORMED_RESPONSE = "malformed_response"
    SCHEMA_VALIDATION = "schema_validation"
    OUTPUT_TRUNCATED = "output_truncated"
    NETWORK = "network"
    CONNECTION = "connection"
    DNS = "dns"
    TLS = "tls"
    PROXY = "proxy"


ERROR_ACTIONS = {
    ModelErrorKind.DNS: "检查 DNS、网络或 Endpoint 配置后重试",
    ModelErrorKind.TLS: "检查证书、代理或系统时间后重试",
    ModelErrorKind.PROXY: "检查系统代理设置，或切换到直连后重试",
    ModelErrorKind.CONNECTION: "检查网络连通性后重试",
    ModelErrorKind.TIMEOUT: "检查网络或缩小请求范围后重试",
    ModelErrorKind.AUTHENTICATION: "检查 API Key 和账户状态后重新测试",
    ModelErrorKind.PERMISSION: "确认账户和模型访问权限",
    ModelErrorKind.INVALID_MODEL: "从最新模型目录重新选择模型",
    ModelErrorKind.RATE_LIMIT: "等待限流窗口结束后重试",
    ModelErrorKind.TEMPORARY_SERVICE: "服务商暂时不可用，稍后重试",
    ModelErrorKind.OUTPUT_TRUNCATED: "缩小单批范围或提高输出上限后重试",
    ModelErrorKind.MALFORMED_RESPONSE: "检查模型响应格式，不要盲目重试",
    ModelErrorKind.SCHEMA_VALIDATION: "检查输出契约或人工复核，不要盲目重试",
    ModelErrorKind.INVALID_REQUEST: "检查请求参数",
    ModelErrorKind.INVALID_RESPONSE: "检查模型响应格式，不要盲目重试",
}


class SiliconFlowError(RuntimeError):
    """模型调用失败的可持久化结构；字符串保持旧日志兼容。"""

    def __init__(
        self,
        kind: ModelErrorKind,
        message: str,
        retryable: bool,
        *,
        stage: str = "business",
        action: str | None = None,
        diagnostic: str | None = None,
        http_status: int | None = None,
        finish_reason: str | None = None,
        response_chars: int | None = None,
        elapsed_ms: int | None = None,
        attempts: int | None = None,
        provider: str | None = None,
        model: str | None = None,
        endpoint_host: str | None = None,
        network_mode: str | None = None,
        prompt_version: str | None = None,
        token_usage: dict[str, int] | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.retryable = retryable
        self.stage = stage
        self.action = action or ERROR_ACTIONS.get(kind, "检查配置后重试")
        self.diagnostic = diagnostic
        self.http_status = http_status
        self.finish_reason = finish_reason
        self.response_chars = response_chars
        self.elapsed_ms = elapsed_ms
        self.attempts = attempts
        self.provider = provider
        self.model = model
        self.endpoint_host = endpoint_host
        self.network_mode = network_mode
        self.prompt_version = prompt_version
        self.token_usage = token_usage

    def to_dict(self) -> dict[str, object]:
        """统一错误结构；绝不包含密钥、Authorization 或请求体。"""
        return {
            "stage": self.stage,
            "kind": str(self.kind),
            "retryable": self.retryable,
            "user_message": str(self),
            "action": self.action,
            "diagnostic": self.diagnostic,
            "provider": self.provider,
            "model": self.model,
            "endpoint_host": self.endpoint_host,
            "network_mode": self.network_mode,
            "prompt_version": self.prompt_version,
            "elapsed_ms": self.elapsed_ms,
            "attempts": self.attempts,
            "http_status": self.http_status,
            "finish_reason": self.finish_reason,
            "response_chars": self.response_chars,
            "token_usage": self.token_usage,
        }


Transport = Callable[[dict[str, object]], tuple[int, str]]
CatalogTransport = Callable[[dict[str, object]], tuple[int, str]]


def configured_timeout(stage: str) -> float:
    """目录/连接测试/业务请求各自可配置，默认 20/20/600 秒。"""
    defaults = {"catalog": 20.0, "connection_test": 20.0, "business": 600.0}
    env_names = {
        "catalog": "AI_CATALOG_TIMEOUT_SECONDS",
        "connection_test": "AI_CONNECTION_TIMEOUT_SECONDS",
        "business": "AI_BUSINESS_TIMEOUT_SECONDS",
    }
    try:
        value = float(os.getenv(env_names[stage], str(defaults[stage])))
    except ValueError:
        return defaults[stage]
    return value if value > 0 else defaults[stage]


def endpoint_host(endpoint: str) -> str:
    return urlparse(endpoint).hostname or ""


PROVIDER_ENDPOINTS = {
    "siliconflow": "https://api.siliconflow.cn/v1/chat/completions",
    "deepseek": "https://api.deepseek.com/chat/completions",
    "kimi": "https://api.moonshot.cn/v1/chat/completions",
}
PROVIDER_MODEL_ENDPOINTS = {
    "siliconflow": "https://api.siliconflow.cn/v1/models",
    "deepseek": "https://api.deepseek.com/models",
    "kimi": "https://api.moonshot.cn/v1/models",
}

CONNECTION_ERROR_KINDS = {ModelErrorKind.NETWORK, ModelErrorKind.TIMEOUT}


def _open_url(request: Request, timeout: float, network_mode: str):
    """direct 模式显式忽略系统代理；system_proxy/auto 使用系统默认代理。"""
    handlers = [ProxyHandler({})] if network_mode == "direct" else []
    return build_opener(*handlers).open(request, timeout=timeout)


def _network_error_kind(reason: object) -> ModelErrorKind:
    if isinstance(reason, socket.gaierror):
        return ModelErrorKind.DNS
    if isinstance(reason, ssl.SSLError):
        return ModelErrorKind.TLS
    text = str(reason).lower()
    if "proxy" in text:
        return ModelErrorKind.PROXY
    return ModelErrorKind.CONNECTION


def _default_transport(request_data: dict[str, object]) -> tuple[int, str]:
    request = Request(
        str(request_data["endpoint"]),
        data=json.dumps(request_data["body"]).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {request_data['api_key']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    timeout = float(request_data.get("timeout", configured_timeout("business")))
    try:
        with _open_url(request, timeout, str(request_data.get("network_mode", "auto"))) as response:
            return response.status, response.read().decode("utf-8")
    except HTTPError as error:
        return error.code, error.read().decode("utf-8", errors="replace")
    except TimeoutError as error:
        raise SiliconFlowError(
            ModelErrorKind.TIMEOUT,
            f"模型请求超时（业务请求层，{timeout:g} 秒）",
            True,
            stage="business",
        ) from error
    except URLError as error:
        is_timeout = isinstance(error.reason, TimeoutError | socket.timeout)
        kind = ModelErrorKind.TIMEOUT if is_timeout else _network_error_kind(error.reason)
        message = f"模型请求超时（业务请求层，{timeout:g} 秒）" if is_timeout else f"模型网络请求失败（{kind}）"
        raise SiliconFlowError(kind, message, is_timeout, stage="business") from error


def _default_catalog_transport(request_data: dict[str, object]) -> tuple[int, str]:
    request = Request(
        str(request_data["endpoint"]),
        headers={"Authorization": f"Bearer {request_data['api_key']}"},
        method="GET",
    )
    timeout = float(request_data.get("timeout", configured_timeout("catalog")))
    try:
        with _open_url(request, timeout, str(request_data.get("network_mode", "auto"))) as response:
            return response.status, response.read().decode("utf-8")
    except HTTPError as error:
        return error.code, error.read().decode("utf-8", errors="replace")
    except TimeoutError as error:
        raise SiliconFlowError(
            ModelErrorKind.TIMEOUT,
            f"模型目录请求超时（目录查询层，{timeout:g} 秒）",
            True,
            stage="catalog",
        ) from error
    except URLError as error:
        is_timeout = isinstance(error.reason, TimeoutError | socket.timeout)
        kind = ModelErrorKind.TIMEOUT if is_timeout else _network_error_kind(error.reason)
        message = f"模型目录请求超时（目录查询层，{timeout:g} 秒）" if is_timeout else f"模型目录网络请求失败（{kind}）"
        raise SiliconFlowError(kind, message, is_timeout, stage="catalog") from error


def _classify_status(status: int) -> tuple[ModelErrorKind, bool]:
    if status == 408:
        return ModelErrorKind.TIMEOUT, True
    if status == 401:
        return ModelErrorKind.AUTHENTICATION, False
    if status == 403:
        return ModelErrorKind.PERMISSION, False
    if status == 404:
        return ModelErrorKind.INVALID_MODEL, False
    if status == 429:
        return ModelErrorKind.RATE_LIMIT, True
    if status >= 500:
        return ModelErrorKind.TEMPORARY_SERVICE, True
    return ModelErrorKind.INVALID_REQUEST, False


def _status_message(status: int) -> str:
    if status in (401, 403):
        return f"模型服务拒绝访问（HTTP {status}），请检查 API Key、账户权限和模型访问权限"
    if status == 400:
        return "模型服务拒绝请求（HTTP 400），请检查模型 ID 和请求参数"
    return f"模型服务返回 HTTP {status}"


def _extract_json(content: str | dict[str, object]) -> dict[str, object]:
    if isinstance(content, dict):
        value = content
    else:
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.removeprefix("```").removeprefix("json").removesuffix("```").strip()
        try:
            value = json.loads(cleaned)
        except json.JSONDecodeError as error:
            raise SiliconFlowError(ModelErrorKind.INVALID_RESPONSE, "模型未返回合法 JSON", False) from error
    if not isinstance(value, dict):
        raise SiliconFlowError(ModelErrorKind.INVALID_RESPONSE, "模型 JSON 顶层必须是对象", False)
    for wrapper in ("diagnosis", "result", "data"):
        wrapped = value.get(wrapper)
        if isinstance(wrapped, dict) and "diagnosis_status" in wrapped:
            return wrapped
    if "diagnosis_status" not in value:
        raise SiliconFlowError(ModelErrorKind.INVALID_RESPONSE, "模型 JSON 缺少诊断结构", False)
    return value
