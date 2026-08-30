"""多服务商 OpenAI 兼容适配层：只返回结构化 JSON，不把密钥带入业务数据。"""

import json
import socket
import time
from collections.abc import Callable
from enum import StrEnum
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ModelErrorKind(StrEnum):
    TIMEOUT = "timeout"
    RATE_LIMIT = "rate_limit"
    TEMPORARY_SERVICE = "temporary_service"
    AUTHENTICATION = "authentication"
    INVALID_REQUEST = "invalid_request"
    INVALID_RESPONSE = "invalid_response"
    NETWORK = "network"


class SiliconFlowError(RuntimeError):
    """模型调用失败的可持久化分类。"""

    def __init__(self, kind: ModelErrorKind, message: str, retryable: bool) -> None:
        super().__init__(message)
        self.kind = kind
        self.retryable = retryable


Transport = Callable[[dict[str, object]], tuple[int, str]]


PROVIDER_ENDPOINTS = {
    "siliconflow": "https://api.siliconflow.cn/v1/chat/completions",
    "deepseek": "https://api.deepseek.com/chat/completions",
    "kimi": "https://api.moonshot.cn/v1/chat/completions",
}


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
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8")
    except HTTPError as error:
        return error.code, error.read().decode("utf-8", errors="replace")
    except TimeoutError as error:
        raise SiliconFlowError(ModelErrorKind.TIMEOUT, "模型请求超时", True) from error
    except URLError as error:
        is_timeout = isinstance(error.reason, TimeoutError | socket.timeout)
        kind = ModelErrorKind.TIMEOUT if is_timeout else ModelErrorKind.NETWORK
        message = "模型请求超时" if is_timeout else "模型网络请求失败"
        raise SiliconFlowError(kind, message, is_timeout) from error


def _classify_status(status: int) -> tuple[ModelErrorKind, bool]:
    if status == 408:
        return ModelErrorKind.TIMEOUT, True
    if status == 401 or status == 403:
        return ModelErrorKind.AUTHENTICATION, False
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


class ProviderAdapter:
    """调用 OpenAI 兼容接口，并对可恢复错误执行有界重试。"""

    def __init__(
        self,
        provider: str,
        endpoint: str | None = None,
        transport: Transport = _default_transport,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.provider = provider
        self._endpoint = endpoint or PROVIDER_ENDPOINTS[provider]
        self._transport = transport
        self._sleep = sleep

    def generate(
        self,
        *,
        api_key: str,
        model: str,
        evidence_json: str,
        prompt_version: str = "diagnosis-v1",
    ) -> dict[str, object]:
        if not api_key:
            raise SiliconFlowError(ModelErrorKind.AUTHENTICATION, f"未配置 {self.provider} API Key", False)
        request_data = {
            "api_key": api_key,
            "endpoint": self._endpoint,
            "body": {
                "model": model,
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "messages": [
                    {
                        "role": "system",
                        "content": f"只返回符合诊断 Schema 的 JSON。Prompt 版本：{prompt_version}",
                    },
                    {"role": "user", "content": evidence_json},
                ],
            },
        }
        for attempt in range(3):
            try:
                response_status, response_text = self._transport(request_data)
                if response_status < 200 or response_status >= 300:
                    kind, retryable = _classify_status(response_status)
                    raise SiliconFlowError(kind, _status_message(response_status), retryable)
                payload = json.loads(response_text)
                content = payload["choices"][0]["message"]["content"]
                if not isinstance(content, str | dict):
                    raise TypeError("content 不是允许的结构化内容")
                return _extract_json(content)
            except SiliconFlowError as error:
                if not error.retryable or attempt == 2:
                    raise
                self._sleep(0.05 * (attempt + 1))
            except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
                raise SiliconFlowError(ModelErrorKind.INVALID_RESPONSE, "模型响应结构无效", False) from error
        raise AssertionError("模型重试循环未返回")

    def check_connection(self, *, api_key: str, model: str) -> None:
        """只检查服务连通性，不把普通回复误判为诊断结果。"""
        if not api_key:
            raise SiliconFlowError(ModelErrorKind.AUTHENTICATION, f"未配置 {self.provider} API Key", False)
        request_data = {
            "api_key": api_key,
            "endpoint": self._endpoint,
            "body": {
                "model": model,
                "temperature": 0,
                "messages": [
                    {"role": "system", "content": "只需确认连接可用，返回任意简短内容即可。"},
                    {"role": "user", "content": "连接测试"},
                ],
            },
        }
        for attempt in range(3):
            try:
                response_status, response_text = self._transport(request_data)
                if response_status < 200 or response_status >= 300:
                    kind, retryable = _classify_status(response_status)
                    raise SiliconFlowError(kind, _status_message(response_status), retryable)
                payload = json.loads(response_text)
                content = payload["choices"][0]["message"]["content"]
                if not isinstance(content, str | dict):
                    raise TypeError("content 不是允许的响应内容")
                return
            except SiliconFlowError as error:
                if not error.retryable or attempt == 2:
                    raise
                self._sleep(0.05 * (attempt + 1))
            except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
                raise SiliconFlowError(ModelErrorKind.INVALID_RESPONSE, "模型响应结构无效", False) from error
        raise AssertionError("连接检查重试循环未返回")


class SiliconFlowAdapter(ProviderAdapter):
    """保留 RC1 公共类名，兼容已有调用方和测试 seam。"""

    def __init__(
        self,
        transport: Transport = _default_transport,
        sleep: Callable[[float], None] = time.sleep,
        endpoint: str | None = None,
    ) -> None:
        super().__init__("siliconflow", endpoint=endpoint, transport=transport, sleep=sleep)


class DeepSeekAdapter(ProviderAdapter):
    def __init__(
        self,
        transport: Transport = _default_transport,
        sleep: Callable[[float], None] = time.sleep,
        endpoint: str | None = None,
    ) -> None:
        super().__init__("deepseek", endpoint=endpoint, transport=transport, sleep=sleep)


class KimiAdapter(ProviderAdapter):
    def __init__(
        self,
        transport: Transport = _default_transport,
        sleep: Callable[[float], None] = time.sleep,
        endpoint: str | None = None,
    ) -> None:
        super().__init__("kimi", endpoint=endpoint, transport=transport, sleep=sleep)
