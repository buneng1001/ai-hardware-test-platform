"""从不可变执行和人工批次快照生成不依赖 AI 的最终事实报告。"""

import json
import sqlite3
from collections import Counter, defaultdict
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.automation_executions import _record_from_row
from app.database import open_database
from app.fact_report_models import FactReport, FactReportCreate
from app.fact_report_rendering import STATUS_LABELS, render_html, render_text
from app.manual_test_results import _batch_from_row
from app.test_group_queries import get_group_row

router = APIRouter(tags=["fact reports"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _source_case_snapshot(case: dict[str, object]) -> dict[str, str]:
    return {
        "case_number": str(case.get("source_case_number") or case.get("case_number", "")),
        "title": str(case.get("title", "")),
        "module": str(case.get("module", "") or "未分类"),
        "test_item": str(case.get("test_item", "") or "未分类"),
    }


def _status_counts(records: list[dict[str, object]]) -> dict[str, int]:
    counts = Counter(str(item["status"]) for item in records)
    return {key: counts[key] for key in STATUS_LABELS}


def _stage_progress(counts: dict[str, int]) -> dict[str, object]:
    if not sum(counts.values()):
        conclusion = "信息不足，建议补充验证"
    elif counts["failed"] or counts["blocked"]:
        conclusion = "建议暂缓并补充验证"
    elif counts["not_executed"]:
        conclusion = "建议有条件进入下一阶段"
    else:
        conclusion = "建议进入下一阶段"
    basis = [f"{STATUS_LABELS[key]} {counts[key]} 项" for key in STATUS_LABELS if counts[key]]
    return {"conclusion": conclusion, "basis": basis or ["没有可汇总的测试结果"]}


def _current_manual_scope(connection: sqlite3.Connection, group_id: int) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT source.id FROM test_group_source_cases item JOIN source_test_cases source
          ON source.id = item.source_test_case_id
        WHERE item.test_group_id = ? AND lower(trim(source.test_type)) IN ('manual', 'mixed', '人工', '混合')
        """,
        (group_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def _automation_snapshot_is_historical(connection: sqlite3.Connection, group_id: int, record: object) -> bool:
    if record.group_snapshot.get("name") != get_group_row(connection, group_id)["name"]:
        return True
    if record.group_snapshot.get("description") != get_group_row(connection, group_id)["description"]:
        return True
    for result in record.case_results:
        case = result.case_snapshot
        if "module" not in case or "test_item" not in case:
            return True
        current = connection.execute(
            """SELECT source.module, source.test_item
               FROM automation_test_cases automation JOIN source_test_cases source
                 ON source.id = automation.source_test_case_id
               WHERE automation.id = ? AND automation.product_version_id = (
                   SELECT product_version_id FROM test_groups WHERE id = ?
               )""",
            (result.automation_test_case_id, group_id),
        ).fetchone()
        if current is None or (current["module"], current["test_item"]) != (case["module"], case["test_item"]):
            return True
        current_package_ids = {
            row["data_package_id"]
            for row in connection.execute(
                """SELECT data_package_id FROM test_group_data_package_assignments
                   WHERE test_group_id = ? AND automation_test_case_id = ?""",
                (group_id, result.automation_test_case_id),
            ).fetchall()
        }
        snapshot_package_ids = {item["id"] for item in case["data_packages"]}
        if current_package_ids != snapshot_package_ids:
            return True
    return False


def _build_snapshot(connection: sqlite3.Connection, group_id: int, command: FactReportCreate) -> dict[str, object]:
    group = get_group_row(connection, group_id)
    version = connection.execute(
        """SELECT version.version, version.name, project.name AS project_name, project.product_name
           FROM product_versions version JOIN projects project ON project.id = version.project_id
           WHERE version.id = ?""",
        (group["product_version_id"],),
    ).fetchone()
    automation_records: list[dict[str, object]] = []
    historical_configuration = False
    automation_info: dict[str, object] | None = None
    if command.automation_execution_id is not None:
        row = connection.execute(
            "SELECT * FROM automation_execution_records WHERE id = ?", (command.automation_execution_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="自动化执行记录不存在")
        if row["test_group_id"] != group_id or row["product_version_id"] != group["product_version_id"]:
            raise HTTPException(status_code=422, detail="自动化执行记录必须属于同一测试组和产品版本")
        record = _record_from_row(connection, row)
        historical_configuration |= _automation_snapshot_is_historical(connection, group_id, record)
        automation_info = {
            "id": record.id,
            "execution_number": record.execution_number,
            "status": record.status,
            "execution_mode": record.execution_mode,
            "started_at": record.started_at.isoformat(),
            "completed_at": record.completed_at.isoformat() if record.completed_at else None,
        }
        for result in record.case_results:
            case = result.case_snapshot
            automation_records.append(
                {
                    **_source_case_snapshot(case),
                    "source": "自动化",
                    "status": result.status,
                    "message": result.message,
                    "executed_at": automation_info["completed_at"],
                }
            )

    manual_records: list[dict[str, object]] = []
    manual_info: list[dict[str, object]] = []
    current_scope = _current_manual_scope(connection, group_id)
    for batch_id in command.manual_batch_ids:
        row = connection.execute("SELECT * FROM manual_test_result_batches WHERE id = ?", (batch_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="人工测试记录批次不存在")
        if row["test_group_id"] != group_id or row["product_version_id"] != group["product_version_id"]:
            raise HTTPException(status_code=422, detail="人工测试记录必须属于同一测试组和产品版本")
        batch = _batch_from_row(connection, row)
        scope = json.loads(row["scope_snapshot"])
        scope_by_id = {item["id"]: item for item in scope}
        historical_configuration |= scope != current_scope
        manual_info.append(
            {"id": batch.id, "batch_number": batch.batch_number, "created_at": batch.created_at.isoformat()}
        )
        for item in batch.report_input:
            case = scope_by_id.get(
                item.source_test_case_id,
                {"case_number": f"来源用例 #{item.source_test_case_id}", "title": "", "module": "", "test_item": ""},
            )
            manual_records.append(
                {
                    **_source_case_snapshot(case),
                    "source": "人工",
                    "status": item.status,
                    "message": item.actual_result or item.notes or "未填写补充说明",
                    "executed_at": item.executed_at.isoformat() if item.executed_at else None,
                }
            )

    all_records = automation_records + manual_records
    by_case: dict[str, list[dict[str, object]]] = defaultdict(list)
    for item in all_records:
        by_case[str(item["case_number"])].append(item)
    inconsistent_cases = {
        number
        for number, records in by_case.items()
        if {str(item["source"]) for item in records} == {"自动化", "人工"}
        and len({str(item["status"]) for item in records}) > 1
    }
    for number in inconsistent_cases:
        for item in by_case[number]:
            item["result_consistency"] = "结果不一致"

    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
    for item in all_records:
        grouped[str(item["module"])].append(item)
    modules = []
    for module, records in sorted(grouped.items()):
        counts = _status_counts(records)
        conclusion = (
            "存在结果不一致"
            if any(item.get("result_consistency") for item in records)
            else _stage_progress(counts)["conclusion"]
        )
        modules.append({"name": module, "conclusion": conclusion, "counts": counts, "records": records})
    cross_module_issues = [
        {"case_number": number, "message": "自动化和人工记录结果不一致，已保留双方事实记录。"}
        for number in sorted(inconsistent_cases)
    ]
    warnings = ["当前记录来自历史配置，报告将使用历史快照。"] if historical_configuration else []
    return {
        "basic_information": {
            "project_name": version["project_name"],
            "product_name": version["product_name"],
            "product_version": version["version"],
            "test_group": group["name"],
            "generated_at": _now(),
            "contains": "自动化和人工结果"
            if automation_records and manual_records
            else "自动化结果"
            if automation_records
            else "人工结果",
            "automation_execution": automation_info,
            "manual_batches": manual_info,
        },
        "warnings": warnings,
        "stage_progress": _stage_progress(_status_counts(all_records)),
        "ai_analysis": {"status": "not_configured", "message": "AI 未配置；事实报告已按确定性记录生成。"},
        "scope_overview": {
            "original_case_count": len(by_case),
            "module_count": len(modules),
            "automation_case_count": len(automation_records),
            "manual_case_count": len(manual_records),
            "counts": _status_counts(all_records),
        },
        "modules": modules,
        "cross_module_issues": cross_module_issues,
    }


def _from_row(row: sqlite3.Row) -> FactReport:
    values = dict(row)
    values["manual_batch_ids"] = json.loads(values["manual_batch_ids"])
    values["snapshot"] = json.loads(values["snapshot"])
    return FactReport.model_validate(values)


def _get_report(connection: sqlite3.Connection, report_id: int) -> FactReport:
    row = connection.execute("SELECT * FROM online_reports WHERE id = ?", (report_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="事实报告不存在")
    return _from_row(row)


@router.post("/api/test-groups/{group_id}/fact-reports", response_model=FactReport, status_code=status.HTTP_201_CREATED)
def create_fact_report(group_id: int, command: FactReportCreate) -> FactReport:
    with open_database() as connection:
        snapshot = _build_snapshot(connection, group_id, command)
        group = get_group_row(connection, group_id)
        report_id = connection.execute(
            """INSERT INTO online_reports
               (test_group_id, product_version_id, automation_execution_id, manual_batch_ids, snapshot, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                group_id,
                group["product_version_id"],
                command.automation_execution_id,
                json.dumps(command.manual_batch_ids),
                json.dumps(snapshot, ensure_ascii=False),
                _now(),
            ),
        ).lastrowid
        return _get_report(connection, report_id)


@router.get("/api/fact-reports/{report_id:int}", response_model=FactReport)
def get_fact_report(report_id: int) -> FactReport:
    with open_database() as connection:
        return _get_report(connection, report_id)


@router.get("/api/fact-reports/{report_id}.txt", response_class=PlainTextResponse)
def download_fact_report_text(report_id: int) -> str:
    with open_database() as connection:
        return render_text(_get_report(connection, report_id))


@router.get("/api/fact-reports/{report_id}.html", response_class=HTMLResponse)
def download_fact_report_html(report_id: int) -> HTMLResponse:
    with open_database() as connection:
        return HTMLResponse(render_html(_get_report(connection, report_id)))
