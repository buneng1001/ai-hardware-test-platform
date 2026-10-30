"""模型请求统一执行：分层超时、有限重试、脱敏请求日志。"""

import json
import time
from collections.abc import Callable

from app.ai_provider_core import (
    CONNECTION_ERROR_KINDS,
    ModelErrorKind,
    SiliconFlowError,
    _classify_status,
    _status_message,
    configured_timeout,
    endpoint_host,
)


class RequestRunner:
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

    def _timeout_for(self, stage: str) -> float:
        return configured_timeout(stage)

    def _record_request(
        self,
        *,
        stage: str,
        model: str,
        started: float,
        status: int | None,
        text: str | None,
        error: SiliconFlowError | None,
        attempt: int,
    ) -> None:
        finish_reason = None
        token_usage = None
        if text:
            try:
                payload = json.loads(text)
                if isinstance(payload, dict):
                    usage = payload.get("usage")
                    token_usage = usage if isinstance(usage, dict) else None
                    choices = payload.get("choices")
                    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                        finish_reason = choices[0].get("finish_reason")
            except json.JSONDecodeError:
                pass
        self.request_logs.append(
            {
                "provider": self.provider,
                "model": model,
                "endpoint_host": endpoint_host(self._endpoint),
                "network_mode": self.network_mode,
                "prompt_version": self.prompt_version,
                "stage": stage,
                "elapsed_ms": int((time.monotonic() - started) * 1000),
                "attempt": attempt + 1,
                "http_status": status,
                "finish_reason": finish_reason,
                "response_chars": len(text) if text is not None else None,
                "token_usage": token_usage,
                "error_kind": str(error.kind) if error else None,
                "error_stage": error.stage if error else None,
            }
        )

    def _execute(
        self,
        transport,
        request_data: dict[str, object],
        *,
        stage: str,
        model: str,
        parse: Callable[[str], object],
    ) -> object:
        """统一最多一次重试、退避、调用上限和脱敏请求日志。"""
        for attempt in range(2):
            if self._cancel_event():
                raise SiliconFlowError(
                    ModelErrorKind.CONNECTION,
                    "模型请求已取消",
                    False,
                    stage=stage,
                    provider=self.provider,
                    model=model,
                    endpoint_host=endpoint_host(self._endpoint),
                    network_mode=self.network_mode,
                )
            self.call_count += 1
            if self.call_count > self.max_calls:
                raise SiliconFlowError(
                    ModelErrorKind.CONNECTION,
                    "已达单次运行调用上限",
                    False,
                    stage=stage,
                    provider=self.provider,
                    model=model,
                    endpoint_host=endpoint_host(self._endpoint),
                )
            started = time.monotonic()
            status: int | None = None
            text: str | None = None
            try:
                status, text = self._call_transport(transport, {**request_data, "timeout": self._timeout_for(stage)})
                if status < 200 or status >= 300:
                    kind, retryable = _classify_status(status)
                    raise SiliconFlowError(
                        kind,
                        f"{_status_message(status)}（{stage}）",
                        retryable,
                        stage=stage,
                        http_status=status,
                        response_chars=len(text),
                    )
                result = parse(text)
                self._record_request(
                    stage=stage,
                    model=model,
                    started=started,
                    status=status,
                    text=text,
                    error=None,
                    attempt=attempt,
                )
                return result
            except SiliconFlowError as error:
                error.stage = stage if error.stage == "business" else error.stage
                error.provider = error.provider or self.provider
                error.model = error.model or model
                error.endpoint_host = error.endpoint_host or endpoint_host(self._endpoint)
                error.network_mode = error.network_mode or self.network_mode
                error.prompt_version = error.prompt_version or self.prompt_version
                error.attempts = error.attempts or attempt + 1
                error.elapsed_ms = int((time.monotonic() - started) * 1000)
                self._record_request(
                    stage=stage,
                    model=model,
                    started=started,
                    status=status,
                    text=text,
                    error=error,
                    attempt=attempt,
                )
                if not error.retryable or attempt >= 1:
                    raise
                if self._cancel_event():
                    raise
                self._sleep(1.0)
            except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
                failure = SiliconFlowError(
                    ModelErrorKind.INVALID_RESPONSE,
                    "模型响应结构无效",
                    False,
                    stage=stage,
                    provider=self.provider,
                    model=model,
                    endpoint_host=endpoint_host(self._endpoint),
                    network_mode=self.network_mode,
                    response_chars=len(text) if text is not None else None,
                )
                self._record_request(
                    stage=stage,
                    model=model,
                    started=started,
                    status=status,
                    text=text,
                    error=failure,
                    attempt=attempt,
                )
                raise failure from error
        raise AssertionError("模型请求重试循环未返回")
