"""硅基流动的独立适配层：只返回结构化 JSON，不把服务商细节带入诊断业务。"""

import json
import time
from collections.abc import Callable
from enum import StrEnum
from typing import Any
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


Transport = Callable[[dict[str, Any]], tuple[int, str]]


def _default_transport(request_data: dict[str, Any]) -> tuple[int, str]:
    request = Request(
        "https://api.siliconflow.cn/v1/chat/completions",
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
        raise SiliconFlowError(ModelErrorKind.NETWORK, "模型网络请求失败", True) from error


def _classify_status(status: int) -> tuple[ModelErrorKind, bool]:
    if status == 401 or status == 403:
        return ModelErrorKind.AUTHENTICATION, False
    if status == 429:
        return ModelErrorKind.RATE_LIMIT, True
    if status >= 500:
        return ModelErrorKind.TEMPORARY_SERVICE, True
    return ModelErrorKind.INVALID_REQUEST, False


def _extract_json(content: str) -> dict[str, Any]:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```").removeprefix("json").removesuffix("```").strip()
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise SiliconFlowError(ModelErrorKind.INVALID_RESPONSE, "模型未返回合法 JSON", False) from error
    if not isinstance(value, dict):
        raise SiliconFlowError(ModelErrorKind.INVALID_RESPONSE, "模型 JSON 顶层必须是对象", False)
    return value


class SiliconFlowAdapter:
    """调用 OpenAI 兼容接口，并对可恢复错误执行有界重试。"""

    def __init__(
        self,
        transport: Transport = _default_transport,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._transport = transport
        self._sleep = sleep

    def generate(
        self,
        *,
        api_key: str,
        model: str,
        evidence_json: str,
        prompt_version: str = "diagnosis-v1",
    ) -> dict[str, Any]:
        if not api_key:
            raise SiliconFlowError(ModelErrorKind.AUTHENTICATION, "未配置硅基流动 API Key", False)
        request_data = {
            "api_key": api_key,
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
                    raise SiliconFlowError(kind, f"模型服务返回 HTTP {response_status}", retryable)
                payload = json.loads(response_text)
                content = payload["choices"][0]["message"]["content"]
                if not isinstance(content, str):
                    raise TypeError("content 不是字符串")
                return _extract_json(content)
            except SiliconFlowError as error:
                if not error.retryable or attempt == 2:
                    raise
                self._sleep(0.05 * (attempt + 1))
            except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
                raise SiliconFlowError(ModelErrorKind.INVALID_RESPONSE, "模型响应结构无效", False) from error
        raise AssertionError("模型重试循环未返回")
