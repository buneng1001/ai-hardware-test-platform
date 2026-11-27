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
    cleaned = content.lstrip("\ufeff").strip()
    if cleaned.startswith("```"):
        first_line, separator, remainder = cleaned.partition("\n")
        if first_line.strip().lower() not in {"```", "```json"} or not separator:
            raise SiliconFlowError(
                ModelErrorKind.INVALID_RESPONSE,
                "模型内容代码围栏格式无效",
                False,
                diagnostic="content_fence_invalid",
                response_chars=len(content),
            )
        cleaned = remainder
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3].strip()
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise SiliconFlowError(
            ModelErrorKind.INVALID_RESPONSE,
            "模型内容不是合法 JSON",
            False,
            diagnostic="content_json_invalid",
            response_chars=len(content),
        ) from error
    if not isinstance(value, dict):
        raise SiliconFlowError(
            ModelErrorKind.INVALID_RESPONSE,
            "模型 JSON 顶层必须是对象",
            False,
            diagnostic="content_json_not_object",
            response_chars=len(content),
        )
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
        self.request_log_sink: Callable[[list[dict[str, object]]], None] | None = None
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
        stream: bool = False,
        max_output_tokens: int | None = None,
        thinking_budget: int | None = None,
        enable_thinking: bool | None = None,
        on_stream_progress: Callable[[int, int], None] | None = None,
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
        if stream:
            body["stream"] = True
        if max_output_tokens is not None:
            body["max_tokens"] = max_output_tokens
        if self.provider == "siliconflow" and enable_thinking is not None:
            body["enable_thinking"] = enable_thinking
        if self.provider == "siliconflow" and thinking_budget is not None and enable_thinking is not False:
            body["enable_thinking"] = True
            body["thinking_budget"] = thinking_budget
        # 限定当前已知支持思考预算的硅基流动模型和报告分析场景；
        # 保留最终输出预算，不把内部推理长度限制当成质量保证。
        if (
            self.provider == "siliconflow"
            and model in {"Qwen/Qwen3.8-27B", "Qwen/Qwen3.8-27B-FP8"}
            and stage
            in {
                "report_analysis",
                "report_analysis_batch",
                "report_analysis_repair",
            }
            and enable_thinking is None
        ):
            body["enable_thinking"] = True
            body["thinking_budget"] = 1024
        request_data = {"api_key": api_key, "endpoint": self._endpoint, "body": body}
        if on_stream_progress is not None:
            request_data["on_stream_progress"] = on_stream_progress

        def parse(text: str) -> dict[str, object]:
            try:
                payload = json.loads(text)
            except json.JSONDecodeError as error:
                raise SiliconFlowError(
                    ModelErrorKind.INVALID_RESPONSE,
                    "模型服务响应外层 JSON 无效",
                    False,
                    stage=stage,
                    diagnostic="response_envelope_json_invalid",
                    response_chars=len(text),
                ) from error
            if not isinstance(payload, dict):
                raise SiliconFlowError(
                    ModelErrorKind.INVALID_RESPONSE,
                    "模型服务响应顶层必须是对象",
                    False,
                    stage=stage,
                    diagnostic="response_envelope_not_object",
                    response_chars=len(text),
                )
            choices = payload.get("choices")
            if not isinstance(choices, list) or not choices:
                raise SiliconFlowError(
                    ModelErrorKind.INVALID_RESPONSE,
                    "模型服务响应缺少 choices",
                    False,
                    stage=stage,
                    diagnostic="response_choices_missing",
                    response_chars=len(text),
                )
            choice = choices[0]
            if not isinstance(choice, dict):
                raise SiliconFlowError(
                    ModelErrorKind.INVALID_RESPONSE,
                    "模型服务响应中的 choice 结构无效",
                    False,
                    stage=stage,
                    diagnostic="response_choice_invalid",
                    response_chars=len(text),
                )
            if choice.get("finish_reason") == "length":
                raise SiliconFlowError(
                    ModelErrorKind.OUTPUT_TRUNCATED,
                    "模型输出被截断（finish_reason=length）",
                    False,
                    stage=stage,
                    finish_reason="length",
                    response_chars=len(text),
                )
            message = choice.get("message")
            if not isinstance(message, dict):
                raise SiliconFlowError(
                    ModelErrorKind.INVALID_RESPONSE,
                    "模型服务响应缺少 message",
                    False,
                    stage=stage,
                    diagnostic="response_message_missing",
                    response_chars=len(text),
                )
            if "content" not in message:
                raise SiliconFlowError(
                    ModelErrorKind.INVALID_RESPONSE,
                    "模型服务响应缺少 content",
                    False,
                    stage=stage,
                    diagnostic="response_content_missing",
                    response_chars=len(text),
                )
            content = message["content"]
            if isinstance(content, dict):
                return content
            if not isinstance(content, str):
                raise SiliconFlowError(
                    ModelErrorKind.INVALID_RESPONSE,
                    "模型 content 类型无效",
                    False,
                    stage=stage,
                    diagnostic="response_content_type_invalid",
                    response_chars=len(text),
                )
            if not content.strip():
                raise SiliconFlowError(
                    ModelErrorKind.INVALID_RESPONSE,
                    "模型 content 为空",
                    False,
                    stage=stage,
                    diagnostic="response_content_empty",
                    response_chars=len(text),
                )
            return _extract_json_object(content)

        result = self._execute(self._transport, request_data, stage=stage, model=model, parse=parse)
        if not isinstance(result, dict):
            raise AssertionError("模型响应返回值类型异常")
        return result
