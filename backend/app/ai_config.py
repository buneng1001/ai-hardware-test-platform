"""AI 配置快照、模型目录和验证状态的持久化。"""

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.database import open_database
from app.siliconflow import PROVIDER_ENDPOINTS

router = APIRouter(prefix="/api/settings/ai", tags=["ai configuration"])

Provider = Literal["siliconflow", "deepseek", "kimi"]
NetworkMode = Literal["auto", "system_proxy", "direct"]
KeySource = Literal["environment", "temporary"]
NETWORK_MODES: list[str] = ["auto", "system_proxy", "direct"]


class AiConfigCommand(BaseModel):
    provider: Provider = "siliconflow"
    model: str = Field(min_length=1, max_length=200)
    key_source: KeySource = "environment"
    network_mode: NetworkMode = "auto"
    prompt_version: str = Field(default="diagnosis-v1", min_length=1, max_length=60)


class AiConfigSnapshot(BaseModel):
    provider: Provider
    endpoint: str
    model: str
    key_source: KeySource
    network_mode: NetworkMode
    prompt_version: str
    fingerprint: str
    created_at: str


class AiCatalogState(BaseModel):
    provider: Provider
    models: list[str]
    source: Literal["provider", "configured"]
    warning: str | None = None
    fetched_at: str
    selected_model: str
    selected_model_available: bool


class AiVerificationState(BaseModel):
    status: Literal["verified", "failed", "invalidated", "untested"]
    message: str
    fingerprint: str | None = None
    error_kind: str | None = None
    retryable: bool = False
    network_diagnostic: str | None = None
    verified_at: str | None = None
    error: dict[str, object] | None = None


class AiConfigState(BaseModel):
    snapshot: AiConfigSnapshot | None
    catalog: AiCatalogState | None
    verification: AiVerificationState
    network_modes: list[str]


def _now() -> str:
    return datetime.now(UTC).isoformat()


def config_fingerprint(
    provider: str,
    endpoint: str,
    model: str,
    key_source: str,
    network_mode: str,
    prompt_version: str,
) -> str:
    """指纹覆盖所有会改变模型调用行为的配置字段。"""
    raw = "|".join([provider, endpoint, model, key_source, network_mode, prompt_version])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def save_selection(
    connection: sqlite3.Connection,
    *,
    provider: str,
    model: str,
    key_source: str,
    network_mode: str,
    prompt_version: str,
) -> sqlite3.Row:
    endpoint = PROVIDER_ENDPOINTS[provider]
    fingerprint = config_fingerprint(provider, endpoint, model, key_source, network_mode, prompt_version)
    connection.execute(
        """INSERT OR IGNORE INTO ai_config_snapshots
           (provider, endpoint, model, key_source, network_mode, prompt_version,
            fingerprint, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            provider,
            endpoint,
            model,
            key_source,
            network_mode,
            prompt_version,
            fingerprint,
            _now(),
        ),
    )
    snapshot = connection.execute("SELECT * FROM ai_config_snapshots WHERE fingerprint = ?", (fingerprint,)).fetchone()
    connection.execute(
        """INSERT INTO ai_config_selection (id, snapshot_id, updated_at)
           VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET snapshot_id = excluded.snapshot_id,
             updated_at = excluded.updated_at""",
        (snapshot["id"], _now()),
    )
    return snapshot


def get_selected_snapshot(connection: sqlite3.Connection) -> sqlite3.Row | None:
    return connection.execute(
        """SELECT snapshot.* FROM ai_config_selection selection
           JOIN ai_config_snapshots snapshot
             ON snapshot.id = selection.snapshot_id
           WHERE selection.id = 1"""
    ).fetchone()


def save_model_catalog(
    connection: sqlite3.Connection,
    *,
    provider: str,
    models: list[str],
    source: str,
    warning: str | None,
) -> None:
    """模型目录单独保存，绝不复用为验证状态或当前选择。"""
    connection.execute(
        """INSERT INTO ai_model_catalogs
           (provider, models, source, warning, fetched_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(provider) DO UPDATE SET models = excluded.models,
             source = excluded.source, warning = excluded.warning,
             fetched_at = excluded.fetched_at""",
        (provider, json.dumps(models, ensure_ascii=False), source, warning, _now()),
    )


def save_verification(
    connection: sqlite3.Connection,
    *,
    snapshot_id: int,
    status: str,
    message: str,
    error_kind: str | None,
    retryable: bool,
    network_diagnostic: str | None,
    error_detail: dict[str, object] | None = None,
) -> None:
    connection.execute(
        """INSERT INTO ai_verification_runs
           (snapshot_id, status, message, error_kind, retryable,
            network_diagnostic, created_at, error_detail)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            snapshot_id,
            status,
            message,
            error_kind,
            int(retryable),
            network_diagnostic,
            _now(),
            json.dumps(error_detail or {}, ensure_ascii=False),
        ),
    )


def _snapshot_model(row: sqlite3.Row) -> AiConfigSnapshot:
    return AiConfigSnapshot(
        provider=row["provider"],
        endpoint=row["endpoint"],
        model=row["model"],
        key_source=row["key_source"],
        network_mode=row["network_mode"],
        prompt_version=row["prompt_version"],
        fingerprint=row["fingerprint"],
        created_at=row["created_at"],
    )


def get_config_state(connection: sqlite3.Connection) -> AiConfigState:
    snapshot_row = get_selected_snapshot(connection)
    if snapshot_row is None:
        return AiConfigState(
            snapshot=None,
            catalog=None,
            verification=AiVerificationState(status="untested", message="尚未保存或验证 AI 配置"),
            network_modes=NETWORK_MODES,
        )
    snapshot = _snapshot_model(snapshot_row)
    catalog_row = connection.execute(
        "SELECT * FROM ai_model_catalogs WHERE provider = ?",
        (snapshot.provider,),
    ).fetchone()
    catalog = None
    if catalog_row is not None:
        models = json.loads(catalog_row["models"])
        catalog = AiCatalogState(
            provider=catalog_row["provider"],
            models=models,
            source=catalog_row["source"],
            warning=catalog_row["warning"],
            fetched_at=catalog_row["fetched_at"],
            selected_model=snapshot.model,
            selected_model_available=snapshot.model in models,
        )
    latest = connection.execute("SELECT * FROM ai_verification_runs ORDER BY id DESC LIMIT 1").fetchone()
    if latest is None:
        verification = AiVerificationState(
            status="untested",
            message="尚未验证当前配置",
            fingerprint=snapshot.fingerprint,
        )
    elif latest["snapshot_id"] != snapshot_row["id"]:
        verification = AiVerificationState(
            status="invalidated",
            message="配置已变更，请重新测试",
            fingerprint=snapshot.fingerprint,
        )
    else:
        verification = AiVerificationState(
            status=latest["status"],
            message=latest["message"],
            fingerprint=snapshot.fingerprint,
            error_kind=latest["error_kind"],
            retryable=bool(latest["retryable"]),
            network_diagnostic=latest["network_diagnostic"],
            verified_at=latest["created_at"],
            error=(
                json.loads(latest["error_detail"])
                if "error_detail" in latest.keys() and latest["error_detail"]
                else None
            ),
        )
    return AiConfigState(
        snapshot=snapshot,
        catalog=catalog,
        verification=verification,
        network_modes=NETWORK_MODES,
    )


def save_request_logs(logs: list[dict[str, object]]) -> None:
    """请求日志只记录脱敏元数据，不含密钥、Authorization 或请求体。"""
    if not logs:
        return
    rows = [
        (
            str(item.get("provider", "")),
            str(item.get("model", "")),
            str(item.get("endpoint_host", "")),
            str(item.get("network_mode", "")),
            str(item.get("prompt_version", "")),
            str(item.get("stage", "")),
            item.get("elapsed_ms"),
            int(item.get("attempt", 1)),
            item.get("http_status"),
            item.get("finish_reason"),
            item.get("response_chars"),
            json.dumps(item.get("token_usage"), ensure_ascii=False) if item.get("token_usage") is not None else None,
            item.get("error_kind"),
            _now(),
        )
        for item in logs
    ]
    with open_database() as connection:
        connection.executemany(
            """INSERT INTO ai_request_logs
               (provider, model, endpoint_host, network_mode, prompt_version,
                stage, elapsed_ms, attempt, http_status, finish_reason,
                response_chars, token_usage, error_kind, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )


def selected_snapshot_payload() -> dict[str, object]:
    """供一次 AI 运行开始冻结配置快照；不含密钥。"""
    with open_database() as connection:
        row = get_selected_snapshot(connection)
    if row is None:
        return {}
    return {
        "provider": row["provider"],
        "endpoint": row["endpoint"],
        "model": row["model"],
        "key_source": row["key_source"],
        "network_mode": row["network_mode"],
        "prompt_version": row["prompt_version"],
        "fingerprint": row["fingerprint"],
    }


@router.get("/config", response_model=AiConfigState)
def get_ai_config() -> AiConfigState:
    with open_database() as connection:
        return get_config_state(connection)


@router.post("/config", response_model=AiConfigState)
def save_ai_config(command: AiConfigCommand) -> AiConfigState:
    from app.settings import validate_model

    validate_model(command.provider, command.model)
    with open_database() as connection:
        save_selection(
            connection,
            provider=command.provider,
            model=command.model,
            key_source=command.key_source,
            network_mode=command.network_mode,
            prompt_version=command.prompt_version,
        )
        return get_config_state(connection)
