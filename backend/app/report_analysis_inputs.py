"""从事实报告快照构造有限 AI 输入，并提供固定 Mock 输出。"""

from app.fact_report_models import (
    ReportAnalysisItem,
    ReportAnalysisOutput,
    ReportStageRecommendation,
)


def analysis_input(snapshot: dict[str, object]) -> tuple[dict[str, object], set[str]]:
    """只选择持久化事实报告内的有限字段，避免把日志或可变资产交给模型。"""
    modules = []
    refs = {"stage_progress"}
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
    return {
        "stage_progress": snapshot["stage_progress"],
        "scope_overview": snapshot["scope_overview"],
        "modules": modules,
        "cross_module_issues": issues,
    }, refs


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
