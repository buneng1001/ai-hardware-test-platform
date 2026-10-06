"""项目最终报告的趋势和显式比较接口。"""

import json
import sqlite3
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query

from app.database import open_database
from app.project_models import (
    ComparisonTarget,
    ModuleComparison,
    ProjectTrend,
    ProjectTrendPoint,
    ReportComparison,
    ReportComparisonRequest,
    ResultCounts,
    ResultSourceCounts,
    ScopeItem,
    TrendModule,
    UnalignedScopeItem,
)

router = APIRouter(tags=["project trends"])

STATUSES = ("passed", "failed", "blocked", "not_executed")


def _empty_counts() -> ResultSourceCounts:
    return ResultSourceCounts()


def _add_count(counts: ResultSourceCounts, source: str, status: str) -> None:
    target = counts.automation if source == "自动化" else counts.manual
    if status in STATUSES:
        setattr(target, status, getattr(target, status) + 1)


def _conclusion(counts: ResultSourceCounts) -> str:
    totals = [counts.automation, counts.manual]
    if any(item.failed or item.blocked for item in totals):
        return "建议暂缓并补充验证"
    if any(item.not_executed for item in totals):
        return "建议有条件进入下一阶段"
    if any(item.passed for item in totals):
        return "建议进入下一阶段"
    return "信息不足，建议补充验证"


def _report_rows(
    connection: sqlite3.Connection,
    project_id: int,
    product_version_id: int | None = None,
    test_group_id: int | None = None,
) -> list[sqlite3.Row]:
    clauses = ["version.project_id = ?"]
    parameters: list[int] = [project_id]
    if product_version_id is not None:
        clauses.append("report.product_version_id = ?")
        parameters.append(product_version_id)
    if test_group_id is not None:
        clauses.append("report.test_group_id = ?")
        parameters.append(test_group_id)
    return connection.execute(
        f"""
        SELECT report.*, version.version AS product_version, test_group.name AS test_group
        FROM online_reports report
        JOIN product_versions version ON version.id = report.product_version_id
        JOIN test_groups test_group ON test_group.id = report.test_group_id
        WHERE {' AND '.join(clauses)}
        ORDER BY report.created_at, report.id
        """,
        parameters,
    ).fetchall()


def _database_report_counts(
    connection: sqlite3.Connection,
    rows: list[sqlite3.Row],
    module: str,
    case_number: str,
) -> dict[int, ResultSourceCounts]:
    """通过 SQLite JSON 聚合不可变报告快照，避免把趋势计数留给应用层猜测。"""
    if not rows:
        return {}
    placeholders = ", ".join("?" for _ in rows)
    clauses = [f"report.id IN ({placeholders})"]
    filter_parameters: list[object] = [row["id"] for row in rows]
    if module:
        clauses.append("COALESCE(json_extract(module.value, '$.name'), '未分类') = ?")
        filter_parameters.append(module)
    if case_number:
        clauses.append("json_extract(record.value, '$.case_number') = ?")
        filter_parameters.append(case_number)
    columns = []
    source_parameters: list[str] = []
    for source, source_name in (("automation", "自动化"), ("manual", "人工")):
        for status in STATUSES:
            columns.append(
                "SUM(CASE WHEN json_extract(record.value, '$.source') = ? "
                f"AND json_extract(record.value, '$.status') = '{status}' THEN 1 ELSE 0 END) "
                f"AS {source}_{status}"
            )
            source_parameters.append(source_name)
    results = connection.execute(
        f"""
        SELECT report.id AS report_id, {', '.join(columns)}
        FROM online_reports report
        JOIN json_each(report.snapshot, '$.modules') module
        JOIN json_each(module.value, '$.records') record
        WHERE {' AND '.join(clauses)}
        GROUP BY report.id
        """,
        [*source_parameters, *filter_parameters],
    ).fetchall()
    return {
        row["report_id"]: ResultSourceCounts(
            automation=ResultCounts(**{status: row[f"automation_{status}"] for status in STATUSES}),
            manual=ResultCounts(**{status: row[f"manual_{status}"] for status in STATUSES}),
        )
        for row in results
    }


def _records(snapshot: dict[str, object], module: str = "", case_number: str = "") -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for module_data in snapshot.get("modules", []):
        if not isinstance(module_data, dict):
            continue
        name = str(module_data.get("name") or "未分类")
        if module and name != module:
            continue
        for record in module_data.get("records", []):
            if not isinstance(record, dict):
                continue
            number = str(record.get("case_number") or "")
            if case_number and number != case_number:
                continue
            records.append(
                {
                    "case_number": number,
                    "title": str(record.get("title") or ""),
                    "module": name,
                    "source": str(record.get("source") or "人工"),
                    "status": str(record.get("status") or "not_executed"),
                }
            )
    return records


def _point_from_row(
    row: sqlite3.Row,
    module: str = "",
    case_number: str = "",
    database_counts: ResultSourceCounts | None = None,
) -> ProjectTrendPoint | None:
    snapshot = json.loads(row["snapshot"])
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for record in _records(snapshot, module, case_number):
        grouped[record["module"]].append(record)
    if not grouped:
        return None
    counts = _empty_counts()
    modules: list[TrendModule] = []
    for name, records in sorted(grouped.items()):
        module_counts = _empty_counts()
        for record in records:
            _add_count(module_counts, record["source"], record["status"])
            _add_count(counts, record["source"], record["status"])
        modules.append(TrendModule(name=name, conclusion=_conclusion(module_counts), counts=module_counts))
    return ProjectTrendPoint(
        report_id=row["id"],
        product_version_id=row["product_version_id"],
        product_version=row["product_version"],
        test_group_id=row["test_group_id"],
        test_group=row["test_group"],
        created_at=row["created_at"],
        lifecycle_status=row["lifecycle_status"],
        counts=database_counts or counts,
        modules=modules,
    )


def _scope(records: list[dict[str, str]]) -> list[ScopeItem]:
    grouped: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for record in records:
        source = "automation" if record["source"] == "自动化" else "manual"
        grouped[(record["case_number"], record["title"], record["module"])].add(source)
    return [
        ScopeItem(case_number=number, title=title, module=module, sources=sorted(sources))
        for (number, title, module), sources in sorted(grouped.items())
    ]


def _aggregate(rows: list[sqlite3.Row]) -> tuple[ResultSourceCounts, dict[str, TrendModule], list[ScopeItem]]:
    counts = _empty_counts()
    by_module: dict[str, ResultSourceCounts] = defaultdict(_empty_counts)
    all_records: list[dict[str, str]] = []
    for row in rows:
        for record in _records(json.loads(row["snapshot"])):
            _add_count(counts, record["source"], record["status"])
            _add_count(by_module[record["module"]], record["source"], record["status"])
            all_records.append(record)
    modules = {
        name: TrendModule(name=name, conclusion=_conclusion(module_counts), counts=module_counts)
        for name, module_counts in by_module.items()
    }
    return counts, modules, _scope(all_records)


def _target_for_reports(project_id: int, rows: list[sqlite3.Row], kind: str, target_id: int) -> ComparisonTarget:
    if not rows:
        raise HTTPException(status_code=422, detail="所选比较对象没有最终报告")
    if kind == "report":
        row = rows[0]
        return ComparisonTarget(
            kind="report",
            id=target_id,
            label=f"报告 #{target_id}（{row['product_version']}）",
            report_ids=[target_id],
        )
    version = rows[0]["product_version"]
    return ComparisonTarget(
        kind="product_version", id=target_id, label=f"产品版本 {version}", report_ids=[row["id"] for row in rows]
    )


def _comparison_rows(connection: sqlite3.Connection, project_id: int, request: ReportComparisonRequest):
    if request.left_report_id is not None:
        rows = _report_rows(connection, project_id)
        selected = {row["id"]: row for row in rows}
        left = selected.get(request.left_report_id)
        right = selected.get(request.right_report_id)
        if left is None or right is None:
            raise HTTPException(status_code=422, detail="所选报告不属于当前项目或已被删除")
        return [left], [right], "report", request.left_report_id, request.right_report_id
    left_rows = [
        row
        for row in _report_rows(connection, project_id, request.left_product_version_id)
        if row["lifecycle_status"] != "superseded"
    ]
    right_rows = [
        row
        for row in _report_rows(connection, project_id, request.right_product_version_id)
        if row["lifecycle_status"] != "superseded"
    ]
    return left_rows, right_rows, "product_version", request.left_product_version_id, request.right_product_version_id


@router.get("/api/projects/{project_id}/trends", response_model=ProjectTrend)
def get_project_trends(
    project_id: int,
    product_version_id: int | None = Query(default=None, gt=0),
    module: str = Query(default="", max_length=120),
    test_group_id: int | None = Query(default=None, gt=0),
    case_number: str = Query(default="", max_length=120),
) -> ProjectTrend:
    module = module.strip()
    case_number = case_number.strip()
    with open_database() as connection:
        project_exists = connection.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone()
        if project_exists is None:
            raise HTTPException(status_code=404, detail="项目不存在")
        all_rows = _report_rows(connection, project_id)
        rows = _report_rows(connection, project_id, product_version_id, test_group_id)
        database_counts = _database_report_counts(connection, rows, module, case_number)
    points = [
        point
        for row in rows
        if (point := _point_from_row(row, module, case_number, database_counts.get(row["id"]))) is not None
    ]
    if not all_rows:
        return ProjectTrend(project_id=project_id, status="empty", message="暂无趋势数据", points=[])
    if not points:
        return ProjectTrend(
            project_id=project_id,
            status="filtered_empty",
            message="当前筛选条件暂无数据",
            points=[],
        )
    if len(points) == 1:
        return ProjectTrend(
            project_id=project_id,
            status="single",
            message="当前筛选条件只有一个报告数据点",
            points=points,
        )
    return ProjectTrend(project_id=project_id, status="ready", message="已按最终报告汇总趋势", points=points)


@router.post("/api/projects/{project_id}/report-comparisons", response_model=ReportComparison)
def compare_project_reports(project_id: int, request: ReportComparisonRequest) -> ReportComparison:
    with open_database() as connection:
        if connection.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="项目不存在")
        left_rows, right_rows, kind, left_id, right_id = _comparison_rows(connection, project_id, request)
    left_target = _target_for_reports(project_id, left_rows, kind, left_id)
    right_target = _target_for_reports(project_id, right_rows, kind, right_id)
    left_counts, left_modules, left_scope = _aggregate(left_rows)
    right_counts, right_modules, right_scope = _aggregate(right_rows)
    shared = sorted(set(left_modules) & set(right_modules))
    modules = [
        ModuleComparison(
            name=name,
            left=left_modules[name].counts,
            right=right_modules[name].counts,
            left_conclusion=left_modules[name].conclusion,
            right_conclusion=right_modules[name].conclusion,
        )
        for name in shared
    ]
    left_keys = {(item.case_number, item.title, item.module): item for item in left_scope}
    right_keys = {(item.case_number, item.title, item.module): item for item in right_scope}
    left_by_number: dict[str, set[str]] = defaultdict(set)
    right_by_number: dict[str, set[str]] = defaultdict(set)
    for item in left_scope:
        left_by_number[item.case_number].add(item.module)
    for item in right_scope:
        right_by_number[item.case_number].add(item.module)
    unaligned = [
        UnalignedScopeItem(
            case_number=number,
            left_modules=sorted(left_by_number[number]),
            right_modules=sorted(right_by_number[number]),
        )
        for number in sorted(set(left_by_number) & set(right_by_number))
        if left_by_number[number] != right_by_number[number]
    ]
    def has_risk(module: TrendModule) -> bool:
        return any(
            source.failed or source.blocked for source in (module.counts.automation, module.counts.manual)
        )

    risks = [name for name in shared if has_risk(left_modules[name]) and has_risk(right_modules[name])]
    return ReportComparison(
        project_id=project_id,
        left=left_target,
        right=right_target,
        counts={"left": left_counts, "right": right_counts},
        modules=modules,
        added_modules=sorted(set(right_modules) - set(left_modules)),
        removed_modules=sorted(set(left_modules) - set(right_modules)),
        added_scope=[item for key, item in right_keys.items() if key not in left_keys],
        removed_scope=[item for key, item in left_keys.items() if key not in right_keys],
        unaligned_scope=unaligned,
        unresolved_risk_modules=risks,
    )
