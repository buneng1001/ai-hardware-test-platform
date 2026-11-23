"""跨业务唯一 AI 调用租约：原子准入、取消意图与持久化中断恢复。

只维护当前一项运行摘要，不承担业务结果存储、调度或排队。
业务实现须在模型调用结束/超时、后续处理清理完成后才调用 finish。
"""

import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ai_config import get_selected_snapshot
from app.ai_global_state import _read_state
from app.database import open_database

router = APIRouter(prefix="/api/settings/ai", tags=["ai invocation"])

OperationType = Literal["diagnosis", "report_analysis", "automation_conversion", "intelligent_regression"]
ExecutionMode = Literal["single_request", "checkpointed_batch"]
FinalStatus = Literal["completed", "failed", "cancelled", "interrupted"]
DISPLAY_NAMES: dict[str, str] = {
    "diagnosis": "运行后诊断",
    "report_analysis": "最终报告 AI 总体分析",
    "automation_conversion": "AI 自动化用例转换",
    "intelligent_regression": "智能回归测试建议",
}
OCCUPIED_MESSAGE = "当前有功能正在占用 AI，请稍后再试。"


def _now() -> str:
    return datetime.now(UTC).isoformat()


class AiInvocationCancelled(RuntimeError):
    """取消意图已生效或租约不再活动；调用方不得继续保存业务结果。"""


class AiInvocationSummary(BaseModel):
    invocation_id: str
    operation_type: OperationType
    display_name: str
    project_id: int | None
    resource_id: int | None
    status: Literal["running"]
    stopping: bool
    started_at: str
    cancel_requested_at: str | None
    config_fingerprint: str
    execution_mode: ExecutionMode
    input_fingerprint: str | None
    project_name: str | None = None


class ActiveInvocationResponse(BaseModel):
    active: AiInvocationSummary | None


class StopAndDisableResponse(BaseModel):
    active: AiInvocationSummary | None
    enabled: bool


def _active_row(connection: sqlite3.Connection) -> sqlite3.Row | None:
    return connection.execute(
        """SELECT invocation.*, projects.name AS project_name
           FROM ai_active_invocation invocation
           LEFT JOIN projects ON projects.id = invocation.project_id
           WHERE invocation.id = 1 AND invocation.status = 'running'"""
    ).fetchone()


def _summary(row: sqlite3.Row) -> AiInvocationSummary:
    return AiInvocationSummary(
        invocation_id=row["invocation_id"],
        operation_type=row["operation_type"],
        display_name=DISPLAY_NAMES[row["operation_type"]],
        project_id=row["project_id"],
        resource_id=row["resource_id"],
        status="running",
        stopping=row["cancel_requested_at"] is not None,
        started_at=row["started_at"],
        cancel_requested_at=row["cancel_requested_at"],
        config_fingerprint=row["config_fingerprint"],
        execution_mode=row["execution_mode"],
        input_fingerprint=row["input_fingerprint"],
        project_name=row["project_name"],
    )


def ensure_no_active_invocation(connection: sqlite3.Connection, *, action: str) -> None:
    """调用方须先 BEGIN IMMEDIATE，和正式配置/开关更新共用 SQLite 写锁。"""
    if not connection.in_transaction:
        raise RuntimeError("检查 AI 运行锁前必须开启写事务")
    active = _active_row(connection)
    if active is not None:
        raise HTTPException(
            status_code=409,
            detail=f"当前「{DISPLAY_NAMES[active['operation_type']]}」仍在运行或正在停止，暂不能{action}",
        )


@dataclass(frozen=True)
class AiInvocationLease:
    invocation_id: str
    # 本次运行配置在启动时冻结；不含密钥，密钥只能由原业务调用层安全读取。
    config_snapshot: MappingProxyType

    def cancel_requested(self) -> bool:
        return is_cancel_requested(self.invocation_id)

    def assert_can_commit(self, connection: sqlite3.Connection) -> None:
        """必须在实际写入业务结果的同一写事务中校验，避免取消与提交竞态。"""
        if not connection.in_transaction:
            raise RuntimeError("业务结果写入必须先 BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT invocation_id, status, cancel_requested_at FROM ai_active_invocation WHERE id = 1"
        ).fetchone()
        if (
            row is None
            or row["invocation_id"] != self.invocation_id
            or row["status"] != "running"
            or row["cancel_requested_at"] is not None
        ):
            raise AiInvocationCancelled("当前 AI 调用已取消、中断或结束，不允许写入业务结果")

    def finish(self, status: Literal["completed", "failed", "cancelled"]) -> FinalStatus:
        return finish_invocation(self.invocation_id, status=status)


def begin_invocation(
    *,
    operation_type: OperationType,
    project_id: int | None = None,
    resource_id: int | None = None,
    execution_mode: ExecutionMode = "single_request",
    input_fingerprint: str | None = None,
    resumed_from_invocation_id: str | None = None,
) -> AiInvocationLease:
    """唯一调用原子准入；无等待队列，冲突立即返回 409。"""
    if operation_type not in DISPLAY_NAMES or execution_mode not in ("single_request", "checkpointed_batch"):
        raise ValueError("不支持的 AI 业务操作或执行模式")
    if any(value is not None and (type(value) is not int or value <= 0) for value in (project_id, resource_id)):
        raise ValueError("项目和业务对象 ID 必须为正整数")
    if input_fingerprint is not None and not re.fullmatch(r"[0-9a-f]{64}", input_fingerprint):
        raise ValueError("输入指纹必须是 SHA-256 十六进制摘要")

    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        state = _read_state(connection)
        if not state.enabled:
            raise HTTPException(status_code=409, detail="全局 AI 已关闭，请先开启")
        if not state.can_enable:
            raise HTTPException(status_code=409, detail=state.reason or "当前 AI 配置尚未验证")
        if _active_row(connection) is not None:
            raise HTTPException(status_code=409, detail=OCCUPIED_MESSAGE)
        selected = get_selected_snapshot(connection)
        if selected is None:
            raise HTTPException(status_code=409, detail="当前正式 AI 配置不可用")
        invocation_id = uuid4().hex
        connection.execute(
            """INSERT INTO ai_active_invocation
               (id, invocation_id, operation_type, project_id, resource_id,
                status, started_at, cancel_requested_at, finished_at,
                config_fingerprint, execution_mode, input_fingerprint)
               VALUES (1, ?, ?, ?, ?, 'running', ?, NULL, NULL, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                 invocation_id = excluded.invocation_id,
                 operation_type = excluded.operation_type,
                 project_id = excluded.project_id,
                 resource_id = excluded.resource_id,
                 status = excluded.status,
                 started_at = excluded.started_at,
                 cancel_requested_at = NULL,
                 finished_at = NULL,
                 config_fingerprint = excluded.config_fingerprint,
                 execution_mode = excluded.execution_mode,
                 input_fingerprint = excluded.input_fingerprint,
                 disable_global_after_finish = 0""",
            (
                invocation_id,
                operation_type,
                project_id,
                resource_id,
                _now(),
                selected["fingerprint"],
                execution_mode,
                input_fingerprint,
            ),
        )
        if execution_mode == "checkpointed_batch" and resource_id is not None and input_fingerprint is not None:
            if resumed_from_invocation_id is not None:
                source = connection.execute(
                    """SELECT 1 FROM ai_batch_runs WHERE invocation_id = ?
                       AND operation_type = ? AND resource_id = ? AND input_fingerprint = ?
                       AND config_fingerprint = ? AND status IN ('interrupted', 'failed', 'cancelled')
                       AND EXISTS (
                           WITH RECURSIVE source_chain(id, parent) AS (
                               SELECT invocation_id, resumed_from_invocation_id
                               FROM ai_batch_runs WHERE invocation_id = ?
                               UNION ALL
                               SELECT run.invocation_id, run.resumed_from_invocation_id
                               FROM ai_batch_runs run JOIN source_chain chain ON run.invocation_id = chain.parent
                           )
                           SELECT 1 FROM ai_batch_units unit
                           WHERE unit.invocation_id IN (SELECT id FROM source_chain)
                       )""",
                    (
                        resumed_from_invocation_id,
                        operation_type,
                        resource_id,
                        input_fingerprint,
                        selected["fingerprint"],
                        resumed_from_invocation_id,
                    ),
                ).fetchone()
                if source is None:
                    raise HTTPException(status_code=409, detail="旧检查点已失效，请重新运行")
            connection.execute(
                """INSERT INTO ai_batch_runs
                   (invocation_id, operation_type, resource_id, input_fingerprint, config_fingerprint,
                    status, resumed_from_invocation_id, created_at)
                   VALUES (?, ?, ?, ?, ?, 'running', ?, ?)""",
                (
                    invocation_id,
                    operation_type,
                    resource_id,
                    input_fingerprint,
                    selected["fingerprint"],
                    resumed_from_invocation_id,
                    _now(),
                ),
            )
        config_snapshot = MappingProxyType(
            {
                field: str(selected[field])
                for field in (
                    "provider",
                    "endpoint",
                    "model",
                    "key_source",
                    "network_mode",
                    "prompt_version",
                    "fingerprint",
                )
            }
        )
    return AiInvocationLease(invocation_id=invocation_id, config_snapshot=config_snapshot)


def is_cancel_requested(invocation_id: str) -> bool:
    """已释放或被新租约替代的调用一律视为不能再继续。"""
    with open_database() as connection:
        row = connection.execute(
            "SELECT invocation_id, status, cancel_requested_at FROM ai_active_invocation WHERE id = 1"
        ).fetchone()
        return (
            row is None
            or row["invocation_id"] != invocation_id
            or row["status"] != "running"
            or row["cancel_requested_at"] is not None
        )


def finish_invocation(invocation_id: str, *, status: Literal["completed", "failed", "cancelled"]) -> FinalStatus:
    """只由本次请求持有者在响应/超时和全部本地收尾后调用，绝不提前释放。"""
    if status not in ("completed", "failed", "cancelled"):
        raise ValueError("非法 AI 调用结束状态")
    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM ai_active_invocation WHERE id = 1").fetchone()
        if row is None or row["invocation_id"] != invocation_id:
            raise AiInvocationCancelled("当前调用租约已失效，不能结束其他调用")
        if row["status"] != "running":
            return row["status"]
        final_status = "cancelled" if row["cancel_requested_at"] is not None else status
        connection.execute(
            "UPDATE ai_active_invocation SET status = ?, finished_at = ? WHERE id = 1",
            (final_status, _now()),
        )
        connection.execute(
            """UPDATE ai_batch_runs SET status = ?, finished_at = ?
               WHERE invocation_id = ? AND status = 'running'""",
            (final_status, _now(), invocation_id),
        )
        if row["disable_global_after_finish"]:
            connection.execute(
                "UPDATE ai_global_state SET enabled = 0, updated_at = ? WHERE id = 1",
                (_now(),),
            )
        return final_status


def recover_interrupted_invocations() -> int:
    """仅在后端启动时调用；不自动重试；已确认停止的调用恢复时关闭全局 AI。"""
    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        pending_disable = connection.execute(
            "SELECT disable_global_after_finish FROM ai_active_invocation WHERE id = 1 AND status = 'running'"
        ).fetchone()
        cursor = connection.execute(
            """UPDATE ai_active_invocation SET status = 'interrupted', finished_at = ?
               WHERE id = 1 AND status = 'running'""",
            (_now(),),
        )
        if pending_disable is not None and pending_disable["disable_global_after_finish"]:
            connection.execute(
                "UPDATE ai_global_state SET enabled = 0, updated_at = ? WHERE id = 1",
                (_now(),),
            )
        connection.execute(
            """UPDATE ai_batch_runs SET status = 'interrupted', finished_at = ?
               WHERE status = 'running'""",
            (_now(),),
        )
        return cursor.rowcount


@router.get("/active-invocation", response_model=ActiveInvocationResponse)
def get_active_invocation() -> ActiveInvocationResponse:
    with open_database() as connection:
        row = _active_row(connection)
        return ActiveInvocationResponse(active=_summary(row) if row is not None else None)


@router.post("/invocations/{invocation_id}/cancel", response_model=AiInvocationSummary)
def request_invocation_cancel(invocation_id: str) -> AiInvocationSummary:
    """只设置取消意图，正在停止时仍占用 AI；真正收尾由原调用负责。"""
    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = _active_row(connection)
        if row is None or row["invocation_id"] != invocation_id:
            raise HTTPException(status_code=404, detail="该 AI 调用已结束或不存在")
        if row["cancel_requested_at"] is None:
            connection.execute(
                "UPDATE ai_active_invocation SET cancel_requested_at = ? WHERE id = 1",
                (_now(),),
            )
        row = _active_row(connection)
        return _summary(row)


@router.post("/invocations/{invocation_id}/stop-and-disable", response_model=StopAndDisableResponse)
def stop_invocation_and_disable(invocation_id: str) -> StopAndDisableResponse:
    """请求取消当前调用，并在原调用完成本地收尾时原子关闭全局 AI。"""
    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = _active_row(connection)
        if row is None:
            connection.execute(
                "UPDATE ai_global_state SET enabled = 0, updated_at = ? WHERE id = 1",
                (_now(),),
            )
            return StopAndDisableResponse(active=None, enabled=False)
        if row["invocation_id"] != invocation_id:
            raise HTTPException(status_code=409, detail="当前 AI 调用已变化，请重新确认")
        connection.execute(
            """UPDATE ai_active_invocation
               SET disable_global_after_finish = 1,
                   cancel_requested_at = COALESCE(cancel_requested_at, ?)
               WHERE id = 1""",
            (_now(),),
        )
        return StopAndDisableResponse(active=_summary(_active_row(connection)), enabled=True)
