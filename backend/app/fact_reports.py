"""从不可变执行和人工批次快照生成不依赖 AI 的最终事实报告。"""

import json
import sqlite3
from collections import Counter, defaultdict
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.automation_executions import _record_from_row
from app.database import open_database
from app.fact_report_models import (
    FactReport,
    FactReportCreate,
    HistoricalReportOption,
    HistoricalReportOptions,
    RegressionAuxiliaryReportOption,
    RegressionAuxiliaryReportOptions,
    RegressionAuxiliarySelection,
)
from app.fact_report_rendering import STATUS_LABELS, render_html, render_text
from app.manual_test_results import _batch_from_row
from app.report_analysis import analysis_is_enabled, enqueue_analysis, latest_analysis, run_analysis_in_background
from app.report_lifecycle import attachment_summary, record_attachment_usage
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
        "priority": str(case.get("priority", "") or ""),
        "preconditions": str(case.get("preconditions", "") or ""),
        "input": str(case.get("input", "") or ""),
        "steps": str(case.get("steps", "") or ""),
        "expected_result": str(case.get("expected_result", "") or ""),
        "test_type": str(case.get("test_type", "") or ""),
        "case_type": str(case.get("case_type", "") or ""),
    }


def _status_counts(records: list[dict[str, object]]) -> dict[str, int]:
    counts = Counter(str(item["status"]) for item in records)
    return {key: counts[key] for key in STATUS_LABELS}


def _pass_rate(counts: dict[str, int]) -> dict[str, object]:
    """通过率只统计已经执行过的用例：通过 /（通过+失败+阻塞）。"""
    tested = counts["passed"] + counts["failed"] + counts["blocked"]
    rate = round(counts["passed"] / tested * 100, 1) if tested else None
    return {
        "tested": tested,
        "passed": counts["passed"],
        "failed": counts["failed"],
        "blocked": counts["blocked"],
        "not_executed": counts["not_executed"],
        "total": sum(counts.values()),
        "rate": rate,
    }


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


def _valid_report_snapshot(snapshot: object) -> bool:
    """只允许已保存、包含实际事实的最终报告充当历史来源。"""
    if not isinstance(snapshot, dict):
        return False
    required = {
        "basic_information": dict,
        "scope_overview": dict,
        "pass_rate": dict,
        "stage_progress": dict,
        "issues": dict,
        "module_summary": list,
        "modules": list,
    }
    if any(not isinstance(snapshot.get(key), expected) for key, expected in required.items()):
        return False
    overall = snapshot["pass_rate"].get("overall")
    counts = snapshot["scope_overview"].get("counts")
    if not isinstance(overall, dict) or not isinstance(counts, dict):
        return False
    total = overall.get("total")
    if not isinstance(total, int) or isinstance(total, bool):
        return False
    # 有真实记录，或基于真实报告创建并保存的历史比较；不能把空对象作为事实来源。
    historical = snapshot.get("historical_reports", [])
    return total > 0 or (
        isinstance(historical, list)
        and bool(historical)
        and all(isinstance(item, dict) and isinstance(item.get("report_id"), int) for item in historical)
    )


def _historical_candidates(connection: sqlite3.Connection, group_id: int) -> list[sqlite3.Row]:
    group = get_group_row(connection, group_id)
    return connection.execute(
        """SELECT report.id, report.snapshot, report.created_at,
                  version.version AS product_version, grp.name AS test_group
           FROM online_reports report
           JOIN product_versions version ON version.id = report.product_version_id
           JOIN test_groups grp ON grp.id = report.test_group_id
           WHERE version.project_id = (SELECT project_id FROM product_versions WHERE id = ?)
           ORDER BY report.created_at DESC, report.id DESC""",
        (group["product_version_id"],),
    ).fetchall()


def _load_historical_sources(
    connection: sqlite3.Connection, group_id: int, report_ids: list[int]
) -> list[dict[str, object]]:
    if not report_ids:
        return []
    candidates = {row["id"]: row for row in _historical_candidates(connection, group_id)}
    result = []
    for report_id in report_ids:
        row = candidates.get(report_id)
        if row is None:
            raise HTTPException(status_code=422, detail=f"历史最终报告 #{report_id} 不存在或不属于当前项目")
        try:
            source = json.loads(row["snapshot"])
        except (ValueError, TypeError):
            source = None
        if not _valid_report_snapshot(source):
            raise HTTPException(status_code=422, detail=f"历史最终报告 #{report_id} 缺少有效事实快照")
        result.append(
            {
                "report_id": report_id,
                "product_version": row["product_version"],
                "test_group": source["basic_information"].get("test_group") or row["test_group"],
                "generated_at": row["created_at"],
                # 历史统计独立冻结；不参与当前版本的聚合、通过率和阶段判定。
                "statistics_snapshot": {
                    key: source[key]
                    for key in ("scope_overview", "pass_rate", "stage_progress", "module_summary")
                    if key in source
                },
            }
        )
    return result


def _build_snapshot(connection: sqlite3.Connection, group_id: int, command: FactReportCreate) -> dict[str, object]:
    group = get_group_row(connection, group_id)
    version = connection.execute(
        """SELECT version.version, version.name, project.name AS project_name,
                  project.product_name, project.product_profile
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
    historical_reports = _load_historical_sources(connection, group_id, command.historical_report_ids)
    if not all_records and not historical_reports:
        raise HTTPException(status_code=422, detail="所选来源没有可报告的事实结果，不能生成空报告")
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
    all_counts = _status_counts(all_records)
    # 产品形态与测试环境写进报告，保证报告能自解释“测的是什么”。
    product_profile: dict[str, object] | None = None
    raw_profile = version["product_profile"]
    if raw_profile:
        try:
            product_profile = json.loads(raw_profile)
        except json.JSONDecodeError:
            product_profile = None

    def issues(status: str) -> list[dict[str, object]]:
        return [
            {
                "case_number": item["case_number"],
                "title": item["title"],
                "module": item["module"],
                "source": item["source"],
                "status": item["status"],
                "actual_result": item["message"],
            }
            for item in all_records
            if item["status"] == status
        ]

    return {
        "basic_information": {
            "project_name": version["project_name"],
            "product_name": version["product_name"],
            "product_version": version["version"],
            "test_group": group["name"],
            "generated_at": _now(),
            "product_profile": product_profile,
            "contains": "自动化和人工结果"
            if automation_records and manual_records
            else "自动化结果"
            if automation_records
            else "人工结果"
            if manual_records
            else "历史最终报告（仅供独立对照）",
            "automation_execution": automation_info,
            "manual_batches": manual_info,
        },
        "historical_reports": historical_reports,
        "warnings": warnings,
        "stage_progress": _stage_progress(_status_counts(all_records)),
        "ai_analysis": {"status": "not_configured", "message": "AI 未配置；事实报告已按确定性记录生成。"},
        "scope_overview": {
            "original_case_count": len(by_case),
            "module_count": len(modules),
            "automation_case_count": len(automation_records),
            "manual_case_count": len(manual_records),
            "counts": all_counts,
        },
        "pass_rate": {
            "overall": _pass_rate(all_counts),
            "automation": _pass_rate(_status_counts(automation_records)),
            "manual": _pass_rate(_status_counts(manual_records)),
        },
        "issues": {
            "failed": issues("failed"),
            "blocked": issues("blocked"),
            "not_executed": issues("not_executed"),
        },
        "module_summary": [
            {
                "name": module["name"],
                "conclusion": module["conclusion"],
                "counts": module["counts"],
                "pass_rate": _pass_rate(module["counts"]),
            }
            for module in modules
        ],
        "modules": modules,
        "cross_module_issues": cross_module_issues,
    }


def _from_row(connection: sqlite3.Connection, row: sqlite3.Row) -> FactReport:
    values = dict(row)
    values["manual_batch_ids"] = json.loads(values["manual_batch_ids"])
    values["snapshot"] = json.loads(values["snapshot"])
    values["historical_report_ids"] = [item["report_id"] for item in values["snapshot"].get("historical_reports", [])]
    values["analysis"] = latest_analysis(connection, values["id"])
    values["attachment_summary"] = attachment_summary(connection, values["id"])
    return FactReport.model_validate(values)


def _get_report(connection: sqlite3.Connection, report_id: int) -> FactReport:
    row = connection.execute(
        """SELECT report.*, version.project_id AS project_id
           FROM online_reports report
           JOIN product_versions version ON version.id = report.product_version_id
           WHERE report.id = ?""",
        (report_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="事实报告不存在")
    return _from_row(connection, row)


@router.get("/api/test-groups/{group_id}/historical-fact-reports", response_model=HistoricalReportOptions)
def list_historical_fact_reports(group_id: int) -> HistoricalReportOptions:
    with open_database() as connection:
        items = []
        for row in _historical_candidates(connection, group_id):
            try:
                snapshot = json.loads(row["snapshot"])
            except (ValueError, TypeError):
                continue
            if not _valid_report_snapshot(snapshot):
                continue
            items.append(
                HistoricalReportOption(
                    id=row["id"],
                    product_version=row["product_version"],
                    test_group=snapshot["basic_information"].get("test_group") or row["test_group"],
                    created_at=datetime.fromisoformat(row["created_at"]),
                    overall=snapshot["pass_rate"]["overall"],
                )
            )
        return HistoricalReportOptions(items=items)


def _regression_auxiliary_candidates(
    connection: sqlite3.Connection, main_report_id: int
) -> list[RegressionAuxiliaryReportOption]:
    main = _get_report(connection, main_report_id)
    excluded = {main_report_id, *main.historical_report_ids}
    candidates = []
    for row in _historical_candidates(connection, main.test_group_id):
        if row["id"] in excluded or row["product_version"] == main.snapshot["basic_information"]["product_version"]:
            continue
        try:
            snapshot = json.loads(row["snapshot"])
        except (ValueError, TypeError):
            continue
        if not _valid_report_snapshot(snapshot):
            continue
        # The project-scoped query above includes only reports belonging to the main report's project.
        analysis = latest_analysis(connection, row["id"])
        candidates.append(
            RegressionAuxiliaryReportOption(
                id=row["id"],
                product_version=row["product_version"],
                test_group=snapshot["basic_information"].get("test_group") or row["test_group"],
                created_at=datetime.fromisoformat(row["created_at"]),
                analysis_status=analysis.status,
            )
        )
    return candidates


@router.get(
    "/api/fact-reports/{report_id:int}/regression-auxiliary-options",
    response_model=RegressionAuxiliaryReportOptions,
)
def list_regression_auxiliary_options(report_id: int) -> RegressionAuxiliaryReportOptions:
    with open_database() as connection:
        return RegressionAuxiliaryReportOptions(items=_regression_auxiliary_candidates(connection, report_id))


@router.post("/api/fact-reports/{report_id:int}/regression-auxiliary-validation")
def validate_regression_auxiliary_reports(
    report_id: int, selection: RegressionAuxiliarySelection
) -> dict[str, list[int]]:
    with open_database() as connection:
        # The source of truth is the stored main-report snapshot, not caller-supplied metadata.
        main = _get_report(connection, report_id)
        excluded = {report_id, *main.historical_report_ids}
        ids = selection.report_ids
        if any(report_id <= 0 for report_id in ids) or len(ids) != len(set(ids)):
            raise HTTPException(status_code=422, detail="辅助报告编号无效或重复")
        if any(report_id in excluded for report_id in ids):
            raise HTTPException(status_code=422, detail="辅助报告不能包含主报告或主报告已纳入的历史报告")
        allowed = {item.id for item in _regression_auxiliary_candidates(connection, report_id)}
        if any(report_id not in allowed for report_id in ids):
            raise HTTPException(status_code=422, detail="辅助报告不存在、跨项目、同版本或缺少有效事实快照")
        return {"report_ids": ids}


@router.post("/api/test-groups/{group_id}/fact-reports", response_model=FactReport, status_code=status.HTTP_201_CREATED)
def create_fact_report(group_id: int, command: FactReportCreate, background_tasks: BackgroundTasks) -> FactReport:
    with open_database() as connection:
        snapshot = _build_snapshot(connection, group_id, command)
        group = get_group_row(connection, group_id)
        connection.execute(
            """UPDATE online_reports SET lifecycle_status = 'superseded'
               WHERE test_group_id = ? AND lifecycle_status != 'superseded'""",
            (group_id,),
        )
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
        record_attachment_usage(connection, report_id, command.manual_batch_ids)
        if analysis_is_enabled(connection):
            enqueue_analysis(connection, report_id)
            background_tasks.add_task(run_analysis_in_background, report_id)
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
