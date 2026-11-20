"""后端权威全局 AI 开关，T02 只管理持久状态和开启准入。"""

import sqlite3

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ai_config import get_config_state
from app.database import open_database

router = APIRouter(prefix="/api/settings/ai", tags=["ai global state"])


class AiGlobalState(BaseModel):
    enabled: bool
    can_enable: bool
    reason: str | None
    provider: str | None
    model: str | None


def _read_state(connection: sqlite3.Connection) -> AiGlobalState:
    config = get_config_state(connection)
    snapshot = config.snapshot
    verified = (
        snapshot is not None
        and config.verification.status == "verified"
        and config.verification.fingerprint == snapshot.fingerprint
    )
    reason = None
    if snapshot is None:
        reason = "请先进入 AI 配置，保存正式模型并完成连接验证"
    elif not verified:
        reason = "当前正式 AI 配置未通过有效连接验证，请重新验证后开启"
    enabled = bool(connection.execute("SELECT enabled FROM ai_global_state WHERE id = 1").fetchone()[0])
    return AiGlobalState(
        enabled=enabled,
        can_enable=verified,
        reason=reason,
        provider=snapshot.provider if snapshot else None,
        model=snapshot.model if snapshot else None,
    )


@router.get("/state", response_model=AiGlobalState)
def get_ai_global_state() -> AiGlobalState:
    with open_database() as connection:
        return _read_state(connection)


@router.put("/state", response_model=AiGlobalState)
def set_ai_global_state(command: dict[str, bool]) -> AiGlobalState:
    if set(command) != {"enabled"} or type(command["enabled"]) is not bool:
        raise HTTPException(status_code=422, detail="enabled 必须为布尔值")
    with open_database() as connection:
        # 与正式配置保存共享 SQLite 写锁，防止验证后在切换前被替换。
        connection.execute("BEGIN IMMEDIATE")
        current = _read_state(connection)
        if command["enabled"] and not current.can_enable:
            raise HTTPException(status_code=409, detail=current.reason)
        connection.execute(
            "UPDATE ai_global_state SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            (int(command["enabled"]),),
        )
        return _read_state(connection)
