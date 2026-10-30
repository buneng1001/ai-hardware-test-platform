"""多服务商 OpenAI 兼容适配层：只返回结构化 JSON，不把密钥带入业务数据。"""

import json
import socket
import time
from collections.abc import Callable
from enum import StrEnum
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener


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
CatalogTransport = Callable[[dict[str, object]], tuple[int, str]]


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
        with _open_url(request, 30, str(request_data.get("network_mode", "auto"))) as response:
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


def _default_catalog_transport(request_data: dict[str, object]) -> tuple[int, str]:
    request = Request(
        str(request_data["endpoint"]),
        headers={"Authorization": f"Bearer {request_data['api_key']}"},
        method="GET",
    )
    try:
        with _open_url(request, 30, str(request_data.get("network_mode", "auto"))) as response:
            return response.status, response.read().decode("utf-8")
    except HTTPError as error:
        return error.code, error.read().decode("utf-8", errors="replace")
    except TimeoutError as error:
        raise SiliconFlowError(ModelErrorKind.TIMEOUT, "模型目录请求超时", True) from error
    except URLError as error:
        is_timeout = isinstance(error.reason, TimeoutError | socket.timeout)
        kind = ModelErrorKind.TIMEOUT if is_timeout else ModelErrorKind.NETWORK
        message = "模型目录请求超时" if is_timeout else "模型目录网络请求失败"
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
        catalog_transport: CatalogTransport = _default_catalog_transport,
        model_endpoint: str | None = None,
        sleep: Callable[[float], None] = time.sleep,
        network_mode: str = "system_proxy",
    ) -> None:
        self.provider = provider
        self._endpoint = endpoint or PROVIDER_ENDPOINTS[provider]
        self._transport = transport
        self._catalog_transport = catalog_transport
        self._model_endpoint = model_endpoint or PROVIDER_MODEL_ENDPOINTS[provider]
        self._sleep = sleep
        self.network_mode = network_mode if network_mode in {"auto", "system_proxy", "direct"} else "auto"
        self.network_diagnostics: list[str] = []

    def _call_transport(self, transport, request_data: dict[str, object]) -> tuple[int, str]:
        """auto 先系统代理再直连；只有连接类错误触发有限回退。"""
        modes = ["system_proxy", "direct"] if self.network_mode == "auto" else [self.network_mode]
        last_error: SiliconFlowError | None = None
        for index, mode in enumerate(modes):
            try:
                result = transport({**request_data, "network_mode": mode})
                if index > 0:
                    self.network_diagnostics.append(f"自动网络回退：系统代理失败，已改用直连（{last_error}）")
                return result
            except SiliconFlowError as error:
                if error.kind not in CONNECTION_ERROR_KINDS or index == len(modes) - 1:
                    raise
                last_error = error
                self.network_diagnostics.append(f"网络模式 {mode} 失败：{error.kind}；准备回退直连")
        raise AssertionError("网络模式回退未返回")

    def list_models(self, *, api_key: str) -> list[str]:
        """读取服务商实时模型目录，保留返回顺序并过滤无效或重复 ID。"""
        if not api_key:
            raise SiliconFlowError(ModelErrorKind.AUTHENTICATION, f"未配置 {self.provider} API Key", False)
        request_data = {"api_key": api_key, "endpoint": self._model_endpoint}
        for attempt in range(3):
            try:
                response_status, response_text = self._call_transport(self._catalog_transport, request_data)
                if response_status < 200 or response_status >= 300:
                    kind, retryable = _classify_status(response_status)
                    raise SiliconFlowError(kind, _status_message(response_status), retryable)
                payload = json.loads(response_text)
                entries = payload["data"]
                if not isinstance(entries, list):
                    raise TypeError("data 不是模型列表")
                models: list[str] = []
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    model_id = entry.get("id")
                    if isinstance(model_id, str) and model_id and model_id not in models:
                        models.append(model_id)
                if not models:
                    raise TypeError("模型列表为空")
                return models
            except SiliconFlowError as error:
                if not error.retryable or attempt == 2:
                    raise
                self._sleep(0.05 * (attempt + 1))
            except (KeyError, TypeError, json.JSONDecodeError) as error:
                raise SiliconFlowError(ModelErrorKind.INVALID_RESPONSE, "模型目录响应结构无效", False) from error
        raise AssertionError("模型目录重试循环未返回")

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
        body = {
            "model": model,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": f"只返回符合诊断 Schema 的 JSON。Prompt 版本：{prompt_version}",
                },
                {"role": "user", "content": evidence_json},
            ],
        }
        if self.provider != "kimi":
            body["temperature"] = 0
        request_data = {
            "api_key": api_key,
            "endpoint": self._endpoint,
            "body": body,
        }
        for attempt in range(3):
            try:
                response_status, response_text = self._call_transport(self._transport, request_data)
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
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": "只需确认连接可用，返回任意简短内容即可。"},
                {"role": "user", "content": "连接测试"},
            ],
        }
        if self.provider != "kimi":
            body["temperature"] = 0
        request_data = {
            "api_key": api_key,
            "endpoint": self._endpoint,
            "body": body,
        }
        for attempt in range(3):
            try:
                response_status, response_text = self._call_transport(self._transport, request_data)
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

    def generate_json(self, *, api_key: str, model: str, evidence_json: str, system_prompt: str) -> dict[str, object]:
        """为报告分析等独立结构化任务复用同一服务商、超时和重试策略。"""
        if not api_key:
            raise SiliconFlowError(ModelErrorKind.AUTHENTICATION, f"未配置 {self.provider} API Key", False)
        body = {
            "model": model,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": evidence_json}],
        }
        if self.provider != "kimi":
            body["temperature"] = 0
        request_data = {"api_key": api_key, "endpoint": self._endpoint, "body": body}
        for attempt in range(3):
            try:
                response_status, response_text = self._call_transport(self._transport, request_data)
                if response_status < 200 or response_status >= 300:
                    kind, retryable = _classify_status(response_status)
                    raise SiliconFlowError(kind, _status_message(response_status), retryable)
                parsed = json.loads(response_text)
                content = parsed["choices"][0]["message"]["content"]
                if isinstance(content, dict):
                    return content
                if isinstance(content, str):
                    return json.loads(content.removeprefix("```json").removeprefix("```").removesuffix("```").strip())
                raise TypeError("content 不是允许的结构化内容")
            except SiliconFlowError as error:
                if not error.retryable or attempt == 2:
                    raise
                self._sleep(0.05 * (attempt + 1))
            except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
                raise SiliconFlowError(ModelErrorKind.INVALID_RESPONSE, "模型响应结构无效", False) from error
        raise AssertionError("模型重试循环未返回")


class SiliconFlowAdapter(ProviderAdapter):
    """保留 RC1 公共类名，兼容已有调用方和测试 seam。"""

    def __init__(
        self,
        transport: Transport = _default_transport,
        catalog_transport: CatalogTransport = _default_catalog_transport,
        sleep: Callable[[float], None] = time.sleep,
        endpoint: str | None = None,
        model_endpoint: str | None = None,
        network_mode: str = "system_proxy",
    ) -> None:
        super().__init__(
            "siliconflow",
            endpoint=endpoint,
            transport=transport,
            catalog_transport=catalog_transport,
            model_endpoint=model_endpoint,
            sleep=sleep,
            network_mode=network_mode,
        )


class DeepSeekAdapter(ProviderAdapter):
    def __init__(
        self,
        transport: Transport = _default_transport,
        catalog_transport: CatalogTransport = _default_catalog_transport,
        sleep: Callable[[float], None] = time.sleep,
        endpoint: str | None = None,
        model_endpoint: str | None = None,
        network_mode: str = "system_proxy",
    ) -> None:
        super().__init__(
            "deepseek",
            endpoint=endpoint,
            transport=transport,
            catalog_transport=catalog_transport,
            model_endpoint=model_endpoint,
            sleep=sleep,
            network_mode=network_mode,
        )


class KimiAdapter(ProviderAdapter):
    def __init__(
        self,
        transport: Transport = _default_transport,
        catalog_transport: CatalogTransport = _default_catalog_transport,
        sleep: Callable[[float], None] = time.sleep,
        endpoint: str | None = None,
        model_endpoint: str | None = None,
        network_mode: str = "system_proxy",
    ) -> None:
        super().__init__(
            "kimi",
            endpoint=endpoint,
            transport=transport,
            catalog_transport=catalog_transport,
            model_endpoint=model_endpoint,
            sleep=sleep,
            network_mode=network_mode,
        )
