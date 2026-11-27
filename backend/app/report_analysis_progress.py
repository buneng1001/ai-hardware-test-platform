"""Durable report progress, scoped to a specific invocation and its checkpoint lineage."""

import json
import sqlite3

from app.database import open_database


def set_phase(invocation_id: str, phase: str) -> None:
    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT plan_json FROM ai_batch_runs WHERE invocation_id = ? AND status = 'running'",
            (invocation_id,),
        ).fetchone()
        if row is not None:
            plan = json.loads(row["plan_json"])
            plan["phase"] = phase
            connection.execute(
                "UPDATE ai_batch_runs SET plan_json = ? WHERE invocation_id = ?",
                (json.dumps(plan), invocation_id),
            )


def report_progress(connection: sqlite3.Connection, report_id: int) -> dict | None:
    run = connection.execute(
        """SELECT invocation_id, status, created_at, plan_json FROM ai_batch_runs
           WHERE operation_type = 'report_analysis' AND resource_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT 1""",
        (report_id,),
    ).fetchone()
    if run is None:
        return None
    plan = json.loads(run["plan_json"] or "{}")
    keys = plan.get("report_batch_keys")
    # Count original semantic batches only; split sub-batches are not extra
    # progress. Old plans have no denominator, so do not invent one.
    units = {
        row[0]
        for row in connection.execute(
            """WITH RECURSIVE chain(id) AS (
                SELECT ?
                UNION
                SELECT b.resumed_from_invocation_id FROM ai_batch_runs b
                JOIN chain ON b.invocation_id = chain.id
                WHERE b.resumed_from_invocation_id IS NOT NULL
            )
            SELECT DISTINCT u.batch_key FROM ai_batch_units u JOIN chain ON u.invocation_id = chain.id""",
            (run["invocation_id"],),
        )
    }
    total = len(keys) if isinstance(keys, list) and keys else None
    completed = len(units.intersection(keys)) if total is not None else None
    if run["status"] == "completed" and total is not None:
        completed = total
    return {
        "invocation_id": run["invocation_id"],
        "status": run["status"],
        "started_at": run["created_at"],
        "phase": plan.get("phase", "preparing"),
        "completed_batches": completed,
        "total_batches": total,
        "saved_units": len(units),
    }
