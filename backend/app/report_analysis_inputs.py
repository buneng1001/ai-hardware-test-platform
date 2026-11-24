"""从事实报告快照构造有限 AI 输入，并提供固定 Mock 输出。"""

import sqlite3
from collections import defaultdict

from app.fact_report_models import (
    ReportAnalysisItem,
    ReportAnalysisOutput,
    ReportStageRecommendation,
)


def analysis_input(snapshot: dict[str, object]) -> tuple[dict[str, object], set[str]]:
    """只选择持久化事实报告内的有限字段，避免把日志或可变资产交给模型。"""
    modules = []
    refs = {"stage_progress", "scope_overview"}
    basic = snapshot.get("basic_information") or {}
    execution_context = {
        key: basic[key]
        for key in (
            "product_name",
            "product_version",
            "test_group",
            "contains",
            "automation_execution",
            "manual_batches",
        )
        if key in basic
    }
    if execution_context:
        refs.add("execution_context")
    for module_index, module in enumerate(snapshot["modules"]):
        module_ref = f"module:{module_index}"
        refs.add(module_ref)
        records = []
        for record_index, record in enumerate(module["records"]):
            record_ref = f"record:{module_index}:{record_index}"
            refs.add(record_ref)
            records.append(
                {
                    "ref": record_ref,
                    "case_number": record["case_number"],
                    "title": record["title"],
                    "source": record["source"],
                    "status": record["status"],
                    "message": record["message"],
                }
            )
        modules.append(
            {
                "ref": module_ref,
                "name": module["name"],
                "conclusion": module["conclusion"],
                "counts": module["counts"],
                "records": records,
            }
        )
    issues = []
    for index, issue in enumerate(snapshot["cross_module_issues"]):
        ref = f"cross_issue:{index}"
        refs.add(ref)
        issues.append({"ref": ref, **issue})
    history = []
    for item in snapshot.get("historical_reports", []):
        ref = f"history_report:{item['report_id']}"
        refs.add(ref)
        history.append({"ref": ref, **item})
    return {
        "historical_reports": history,
        "stage_progress": snapshot["stage_progress"],
        "scope_overview": snapshot["scope_overview"],
        "execution_context": execution_context,
        "modules": modules,
        "cross_module_issues": issues,
    }, refs


def source_catalog_context(
    connection: sqlite3.Connection, version_id: int, data: dict[str, object]
) -> dict[str, object]:
    """只收集当前版本用例定义摘要，不读取历史结果、步骤、附件或未选执行数据。"""
    reported = {
        (module["name"], record["case_number"])
        for module in data.get("modules", [])
        for record in module.get("records", [])
    }
    rows = connection.execute(
        """SELECT case_number, title, module, test_type, test_item FROM source_test_cases
           WHERE product_version_id = ? ORDER BY id""",
        (version_id,),
    )
    groups = defaultdict(lambda: {"defined_count": 0, "matching_report_number_count": 0, "other_title_examples": []})
    total = 0
    matched = 0
    for row in rows:
        module = row["module"] or "未分类"
        key = (module, row["test_type"] or "未分类", row["test_item"] or "未分类")
        group = groups[key]
        group["defined_count"] += 1
        total += 1
        if (module, row["case_number"]) in reported:
            group["matching_report_number_count"] += 1
            matched += 1
        elif len(group["other_title_examples"]) < 4:
            group["other_title_examples"].append({"case_number": row["case_number"][:100], "title": row["title"][:150]})
    ordered = sorted(groups.items(), key=lambda pair: (not pair[1]["matching_report_number_count"], pair[0]))
    return {
        "defined_count": total,
        "matching_report_number_count": matched,
        "group_count": len(groups),
        "omitted_group_count": max(0, len(groups) - 60),
        "match_basis": "仅按模块与来源用例编号匹配，不是执行状态或精确覆盖率；样例非完整目录",
        "groups": [
            {"module": key[0][:100], "test_type": key[1][:100], "test_item": key[2][:100], **group}
            for key, group in ordered[:60]
        ],
    }


def _item(content: str, evidence_ref: str) -> ReportAnalysisItem:
    return ReportAnalysisItem(content=content, evidence_refs=[evidence_ref])


def build_mock_analysis(analysis_input: dict[str, object]) -> ReportAnalysisOutput:
    """离线演示使用固定结构化输出，避免 Mock 随输入产生不可复现结论。"""
    return ReportAnalysisOutput(
        risks=[_item("请优先人工复核已保存报告中的失败、阻塞和结果不一致项。", "stage_progress")],
        additional_verifications=[_item("请依据现有事实记录补充验证，不新增未记录的阈值。", "stage_progress")],
        regression_recommendations=[_item("请从已保存报告范围内选择后续回归项。", "stage_progress")],
        stage_recommendation=ReportStageRecommendation(
            suggestion="请依据已保存事实报告补充验证后，再决定是否推进阶段。",
            content="阶段建议仅作为参考，不构成强制质量门禁。",
            evidence_refs=["stage_progress"],
        ),
    )
