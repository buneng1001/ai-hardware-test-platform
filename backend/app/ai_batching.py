"""AI 长输入语义分批、预算预检和检查点。"""

import hashlib
import json
import math
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.database import open_database
from app.siliconflow import ModelErrorKind, SiliconFlowError

DEFAULT_MODULES_PER_BATCH = 6
DEFAULT_RECORDS_PER_BATCH = 60
DEFAULT_CASES_PER_BATCH = 20
DEFAULT_OUTPUT_RESERVE_TOKENS = 8192
DEFAULT_CALL_LIMIT = 40
DEFAULT_CONTEXT_TOKEN_LIMIT = 128000


@dataclass(frozen=True)
class BatchConfig:
    modules_per_batch: int = DEFAULT_MODULES_PER_BATCH
    records_per_batch: int = DEFAULT_RECORDS_PER_BATCH
    cases_per_batch: int = DEFAULT_CASES_PER_BATCH
    output_reserve_tokens: int = DEFAULT_OUTPUT_RESERVE_TOKENS
    call_limit: int = DEFAULT_CALL_LIMIT
    context_token_limit: int = DEFAULT_CONTEXT_TOKEN_LIMIT

    def __post_init__(self) -> None:
        if not 1 <= self.modules_per_batch <= 20:
            raise ValueError("单批模块数必须在 1～20 之间")
        for name in ("records_per_batch", "cases_per_batch", "call_limit"):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} 必须为正整数")


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


def batch_config(overrides: dict[str, int] | None = None) -> BatchConfig:
    """默认值来自环境变量，单次运行可用 overrides 覆盖。"""
    values = {
        "modules_per_batch": _env_int("AI_BATCH_MODULES_PER_BATCH", DEFAULT_MODULES_PER_BATCH),
        "records_per_batch": _env_int("AI_BATCH_RECORDS_PER_BATCH", DEFAULT_RECORDS_PER_BATCH),
        "cases_per_batch": _env_int("AI_BATCH_CASES_PER_BATCH", DEFAULT_CASES_PER_BATCH),
        "output_reserve_tokens": _env_int("AI_OUTPUT_RESERVE_TOKENS", DEFAULT_OUTPUT_RESERVE_TOKENS),
        "call_limit": _env_int("AI_CALL_LIMIT", DEFAULT_CALL_LIMIT),
        "context_token_limit": _env_int("AI_CONTEXT_TOKEN_LIMIT", DEFAULT_CONTEXT_TOKEN_LIMIT),
    }
    values.update(overrides or {})
    return BatchConfig(**values)


def estimate_tokens(text: str) -> int:
    """保守估算：约 4 字符 = 1 Token，至少 1。"""
    return max(1, math.ceil(len(text) / 4))


def preflight_budget(text: str, config: BatchConfig) -> None:
    """提示词 + 预留输出超过安全预算时立即拒绝，不发出请求。"""
    needed = estimate_tokens(text) + config.output_reserve_tokens
    if needed > config.context_token_limit:
        raise SiliconFlowError(
            ModelErrorKind.INVALID_REQUEST,
            f"输入超出模型上下文预算（约 {needed} Token，上限 {config.context_token_limit}），请缩小单批范围或更换模型",
            False,
            stage="report_analysis",
            action="缩小单批模块/记录范围或更换更大上下文模型",
        )


def _module_batches(module: dict[str, Any], config: BatchConfig) -> list[dict[str, Any]]:
    records = module.get("records", [])
    if not isinstance(records, list) or not records:
        return [{"modules": [{**module, "records": []}]}]
    chunks = [
        records[index : index + config.records_per_batch] for index in range(0, len(records), config.records_per_batch)
    ]
    return [{"modules": [{**module, "records": chunk}]} for chunk in chunks]


def semantic_batches(analysis_input: dict[str, Any], config: BatchConfig) -> list[dict[str, Any]]:
    """按模块和记录切批，绝不按字符数切分。"""
    modules = analysis_input.get("modules", [])
    if not isinstance(modules, list) or not modules:
        return [{"modules": [], "stage_progress": analysis_input.get("stage_progress")}]
    batches: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    for module in modules:
        for part in _module_batches(module, config):
            current.append(part["modules"][0])
            if len(current) >= config.modules_per_batch:
                batches.append(
                    {
                        "modules": current,
                        "stage_progress": analysis_input.get("stage_progress"),
                    }
                )
                current = []
    if current:
        batches.append({"modules": current, "stage_progress": analysis_input.get("stage_progress")})
    for batch in batches:
        refs = ["stage_progress"]
        for module in batch["modules"]:
            if module.get("ref"):
                refs.append(str(module["ref"]))
            for record in module.get("records", []):
                if record.get("ref"):
                    refs.append(str(record["ref"]))
        batch["key"] = _batch_key(batch)
        batch["refs"] = refs
    return batches


def _batch_key(batch: dict[str, Any]) -> str:
    refs: list[str] = []
    for module in batch.get("modules", []):
        if module.get("ref"):
            refs.append(str(module["ref"]))
        refs.extend(str(record["ref"]) for record in module.get("records", []) if record.get("ref"))
    raw = "|".join(refs) or "empty"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def split_batch(batch: dict[str, Any]) -> list[dict[str, Any]] | None:
    """二分多个语义单元；缩减到单一单元仍超限时返回 None。"""
    modules = batch.get("modules", [])
    for index, module in enumerate(modules):
        records = module.get("records", [])
        if len(records) > 1:
            mid = len(records) // 2
            first = {
                **batch,
                "modules": [
                    *modules[:index],
                    {**module, "records": records[:mid]},
                    *modules[index + 1 :],
                ],
            }
            second = {
                **batch,
                "modules": [
                    *modules[:index],
                    {**module, "records": records[mid:]},
                    *modules[index + 1 :],
                ],
            }
            for part in (first, second):
                part["key"] = _batch_key(part)
                part["refs"] = _refs_for(part)
            return [first, second]
    if len(modules) > 1:
        mid = len(modules) // 2
        parts = [
            {**batch, "modules": modules[:mid]},
            {**batch, "modules": modules[mid:]},
        ]
        for part in parts:
            part["key"] = _batch_key(part)
            part["refs"] = _refs_for(part)
        return parts
    return None


def _refs_for(batch: dict[str, Any]) -> list[str]:
    refs = ["stage_progress"]
    for module in batch.get("modules", []):
        if module.get("ref"):
            refs.append(str(module["ref"]))
        refs.extend(str(record["ref"]) for record in module.get("records", []) if record.get("ref"))
    return refs


def input_fingerprint(analysis_input: dict[str, Any], provider: str, model: str) -> str:
    raw = json.dumps(
        {"input": analysis_input, "provider": provider, "model": model},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def run_fingerprint(
    analysis_input: dict[str, Any],
    config_snapshot: dict[str, Any],
    model: str,
    prompt_version: str,
) -> str:
    """运行指纹覆盖输入材料、配置快照、模型和 Prompt；不含明文密钥。"""
    raw = json.dumps(
        {
            "input": analysis_input,
            "config": config_snapshot,
            "model": model,
            "prompt_version": prompt_version,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class DatabaseCheckpoints:
    """按报告 + 输入指纹 + 语义批次键保存检查点。"""

    def __init__(self, report_id: int, fingerprint: str) -> None:
        self.report_id = report_id
        self.fingerprint = fingerprint

    def get(self, key: str) -> dict[str, Any] | None:
        with open_database() as connection:
            row = connection.execute(
                """SELECT output FROM report_analysis_batches
                   WHERE report_id = ? AND input_fingerprint = ? AND batch_key = ?
                     AND status = 'completed'""",
                (self.report_id, self.fingerprint, key),
            ).fetchone()
        return json.loads(row["output"]) if row else None

    def save(
        self,
        key: str,
        status: str,
        output: dict[str, Any] | None,
        error: str | None,
        attempts: int,
    ) -> None:
        now = datetime.now(UTC).isoformat()
        with open_database() as connection:
            connection.execute(
                """INSERT INTO report_analysis_batches
                   (report_id, input_fingerprint, batch_key, status, output, error,
                    attempts, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(report_id, input_fingerprint, batch_key) DO UPDATE SET
                     status = excluded.status, output = excluded.output,
                     error = excluded.error, attempts = excluded.attempts,
                     updated_at = excluded.updated_at""",
                (
                    self.report_id,
                    self.fingerprint,
                    key,
                    status,
                    json.dumps(output, ensure_ascii=False) if output is not None else None,
                    error,
                    attempts,
                    now,
                    now,
                ),
            )
