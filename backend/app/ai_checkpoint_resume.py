"""T08 business-scoped checkpoints: explicit human resume, no automatic retry or scheduling."""

import json
import sqlite3
from datetime import UTC, datetime

from app.database import open_database

TERMINAL_RESUMABLE = ("interrupted", "failed", "cancelled")


def _now() -> str:
    return datetime.now(UTC).isoformat()


def eligible_run(
    connection: sqlite3.Connection,
    *,
    operation_type: str,
    resource_id: int,
    fingerprint: str,
    config_fingerprint: str,
    expected_plan: dict | None = None,
) -> sqlite3.Row | None:
    """Only a terminal invocation with a persisted, complete unit can be resumed."""
    latest = connection.execute(
        """SELECT run.* FROM ai_batch_runs run
           WHERE operation_type = ? AND resource_id = ? AND input_fingerprint = ?
             AND config_fingerprint = ?
           ORDER BY run.created_at DESC, run.rowid DESC LIMIT 1""",
        (operation_type, resource_id, fingerprint, config_fingerprint),
    ).fetchone()
    if latest is None or latest["status"] not in TERMINAL_RESUMABLE:
        return None
    if expected_plan is not None:
        try:
            previous_plan = json.loads(latest["plan_json"])
        except (TypeError, ValueError):
            return None
        if not isinstance(previous_plan, dict) or any(
            previous_plan.get(key) != value for key, value in expected_plan.items()
        ):
            return None
    # A failed resumed run may have no new units but still reference a
    # committed ancestor; that chain remains eligible for human continuation.
    return latest if completed_units(str(latest["invocation_id"])) else None


def resume_source(
    operation_type: str,
    resource_id: int,
    fingerprint: str,
    config_fingerprint: str,
    expected_plan: dict | None = None,
) -> str | None:
    with open_database() as connection:
        row = eligible_run(
            connection,
            operation_type=operation_type,
            resource_id=resource_id,
            fingerprint=fingerprint,
            config_fingerprint=config_fingerprint,
            expected_plan=expected_plan,
        )
        return str(row["invocation_id"]) if row else None


def completed_units(source_id: str | None) -> dict[str, dict]:
    """Read the source checkpoint chain; newest completed unit wins."""
    if source_id is None:
        return {}
    with open_database() as connection:
        result: dict[str, dict] = {}
        visited: set[str] = set()
        current = source_id
        while current and current not in visited:
            visited.add(current)
            row = connection.execute(
                "SELECT resumed_from_invocation_id FROM ai_batch_runs WHERE invocation_id = ?",
                (current,),
            ).fetchone()
            if row is None:
                break
            for unit in connection.execute(
                "SELECT batch_key, output_json FROM ai_batch_units WHERE invocation_id = ?", (current,)
            ):
                if unit["batch_key"] not in result:
                    result[unit["batch_key"]] = json.loads(unit["output_json"])
            current = row["resumed_from_invocation_id"]
        return result


def save_unit(connection: sqlite3.Connection, invocation_id: str, key: str, index: int, output: dict) -> None:
    """Caller checks lease and commits the unit atomically with its business effects."""
    connection.execute(
        """INSERT INTO ai_batch_units (invocation_id, batch_key, batch_index, output_json, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (invocation_id, key, index, json.dumps(output, ensure_ascii=False), _now()),
    )


def save_plan(invocation_id: str, plan: dict) -> None:
    with open_database() as connection:
        connection.execute(
            "UPDATE ai_batch_runs SET plan_json = ? WHERE invocation_id = ? AND status = 'running'",
            (json.dumps(plan, ensure_ascii=False), invocation_id),
        )
