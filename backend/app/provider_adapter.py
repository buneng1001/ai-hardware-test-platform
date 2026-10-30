"""服务商适配器：组装请求并按阶段调用统一执行器。"""

import json
import time
from collections.abc import Callable

from app.ai_provider_core import (
    PROVIDER_ENDPOINTS,
    PROVIDER_MODEL_ENDPOINTS,
    CatalogTransport,
    ModelErrorKind,
    SiliconFlowError,
    Transport,
    _default_catalog_transport,
    _default_transport,
    _extract_json,
)
from app.ai_request_runner import RequestRunner


def _extract_json_object(content: str | dict[str, object]) -> dict[str, object]:
    """报告分析等通用结构化任务只要求 JSON 对象，不套用诊断字段约束。"""
    if isinstance(content, dict):
        return content
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```").removeprefix("json")
        cleaned = cleaned.removesuffix("```").strip()
    value = json.loads(cleaned)
    if not isinstance(value, dict):
        raise TypeError("模型 JSON 顶层必须是对象")
    return value


class ProviderAdapter(RequestRunner):
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
        cancel_event: Callable[[], bool] | None = None,
        prompt_version: str = "unknown",
        max_calls: int = 40,
    ) -> None:
        self.provider = provider
        self._endpoint = endpoint or PROVIDER_ENDPOINTS[provider]
        self._transport = transport
        self._catalog_transport = catalog_transport
        self._model_endpoint = model_endpoint or PROVIDER_MODEL_ENDPOINTS[provider]
        self._sleep = sleep
        self.network_mode = network_mode if network_mode in {"auto", "system_proxy", "direct"} else "auto"
        self.network_diagnostics: list[str] = []
        self.request_logs: list[dict[str, object]] = []
        self._cancel_event = cancel_event or (lambda: False)
        self.prompt_version = prompt_version
        self.max_calls = max_calls
        self.call_count = 0

    def list_models(self, *, api_key: str) -> list[str]:
        """读取服务商实时模型目录，保留返回顺序并过滤无效或重复 ID。"""
        if not api_key:
            raise SiliconFlowError(
                ModelErrorKind.AUTHENTICATION,
                f"未配置 {self.provider} API Key",
                False,
                stage="catalog",
                provider=self.provider,
            )
        request_data = {"api_key": api_key, "endpoint": self._model_endpoint}

        def parse(text: str) -> list[str]:
            payload = json.loads(text)
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
                raise SiliconFlowError(
                    ModelErrorKind.INVALID_RESPONSE,
                    "模型目录响应为空",
                    False,
                    stage="catalog",
                )
            return models

        result = self._execute(
            self._catalog_transport,
            request_data,
            stage="catalog",
            model="",
            parse=parse,
        )
        if not isinstance(result, list):
            raise AssertionError("模型目录返回值类型异常")
        return result

    def generate(
        self,
        *,
        api_key: str,
        model: str,
        evidence_json: str,
        prompt_version: str = "diagnosis-v1",
        stage: str = "business",
    ) -> dict[str, object]:
        if not api_key:
            raise SiliconFlowError(
                ModelErrorKind.AUTHENTICATION,
                f"未配置 {self.provider} API Key",
                False,
                stage=stage,
                provider=self.provider,
                model=model,
            )
        self.prompt_version = prompt_version
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

        def parse(text: str) -> dict[str, object]:
            payload = json.loads(text)
            choice = payload["choices"][0]
            if choice.get("finish_reason") == "length":
                raise SiliconFlowError(
                    ModelErrorKind.OUTPUT_TRUNCATED,
                    "模型输出被截断（finish_reason=length）",
                    False,
                    stage=stage,
                    finish_reason="length",
                    response_chars=len(text),
                )
            content = choice["message"]["content"]
            if not isinstance(content, str | dict):
                raise TypeError("content 不是允许的结构化内容")
            return _extract_json(content)

        result = self._execute(self._transport, request_data, stage=stage, model=model, parse=parse)
        if not isinstance(result, dict):
            raise AssertionError("模型响应返回值类型异常")
        return result

    def check_connection(self, *, api_key: str, model: str) -> None:
        """只检查服务连通性，不把普通回复误判为诊断结果。"""
        if not api_key:
            raise SiliconFlowError(
                ModelErrorKind.AUTHENTICATION,
                f"未配置 {self.provider} API Key",
                False,
                stage="connection_test",
                provider=self.provider,
                model=model,
            )
        self.prompt_version = "connection-test-v1"
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

        def parse(text: str) -> None:
            payload = json.loads(text)
            content = payload["choices"][0]["message"]["content"]
            if not isinstance(content, str | dict):
                raise TypeError("content 不是允许的响应内容")
            return None

        self._execute(
            self._transport,
            request_data,
            stage="connection_test",
            model=model,
            parse=parse,
        )

    def generate_json(
        self,
        *,
        api_key: str,
        model: str,
        evidence_json: str,
        system_prompt: str,
        prompt_version: str = "report-analysis-v1",
        stage: str = "report_analysis",
    ) -> dict[str, object]:
        """为报告分析等独立结构化任务复用同一服务商、超时和重试策略。"""
        if not api_key:
            raise SiliconFlowError(
                ModelErrorKind.AUTHENTICATION,
                f"未配置 {self.provider} API Key",
                False,
                stage=stage,
                provider=self.provider,
                model=model,
            )
        self.prompt_version = prompt_version
        body = {
            "model": model,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": evidence_json}],
        }
        if self.provider != "kimi":
            body["temperature"] = 0
        request_data = {"api_key": api_key, "endpoint": self._endpoint, "body": body}

        def parse(text: str) -> dict[str, object]:
            payload = json.loads(text)
            choice = payload["choices"][0]
            if choice.get("finish_reason") == "length":
                raise SiliconFlowError(
                    ModelErrorKind.OUTPUT_TRUNCATED,
                    "模型输出被截断（finish_reason=length）",
                    False,
                    stage=stage,
                    finish_reason="length",
                    response_chars=len(text),
                )
            content = choice["message"]["content"]
            if isinstance(content, dict):
                return content
            if not isinstance(content, str):
                raise TypeError("content 不是允许的结构化内容")
            return _extract_json_object(content)

        result = self._execute(self._transport, request_data, stage=stage, model=model, parse=parse)
        if not isinstance(result, dict):
            raise AssertionError("模型响应返回值类型异常")
        return result
