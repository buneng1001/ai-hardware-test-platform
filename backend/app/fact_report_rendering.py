"""将事实报告快照渲染为保持同一结论顺序的可下载格式。"""

import html
import json

from app.fact_report_models import FactReport

STATUS_LABELS = {
    "passed": "通过",
    "failed": "失败",
    "blocked": "阻塞",
    "not_executed": "未执行",
}


def render_text(report: FactReport) -> str:
    data = report.snapshot
    basic = data["basic_information"]
    lines = [
        "测试基本信息",
        *(f"{key}：{value}" for key, value in basic.items() if value is not None),
        "",
        "阶段推进事实依据",
        f"结论：{data['stage_progress']['conclusion']}",
        *data["stage_progress"]["basis"],
        "",
        "AI 区域状态",
        report.analysis.message,
        "",
        "范围总览",
        json.dumps(data["scope_overview"], ensure_ascii=False),
        "",
        "模块详情",
    ]
    if report.analysis.output:
        output = report.analysis.output
        lines.extend(
            [
                "AI 高风险问题",
                *([f"- {item.content}" for item in output.risks] or ["无"]),
                "AI 补充验证",
                *([f"- {item.content}" for item in output.additional_verifications] or ["无"]),
                "AI 回归建议",
                *([f"- {item.content}" for item in output.regression_recommendations] or ["无"]),
                "AI 阶段推进建议",
                output.stage_recommendation.suggestion,
            ]
        )
    for module in data["modules"]:
        lines.extend([f"\n模块：{module['name']}", f"当前事实结论：{module['conclusion']}"])
        for item in module["records"]:
            consistency = f"；{item['result_consistency']}" if item.get("result_consistency") else ""
            result = STATUS_LABELS[item["status"]]
            lines.append(
                f"- {item['case_number']} {item['title']}：{item['source']} {result}{consistency}；{item['message']}"
            )
    lines.extend(["", "附件使用状态"])
    if report.attachment_summary.attachments:
        lines.extend(
            f"- {item.filename}：已使用；{'已清理' if item.storage_status == 'cleaned' else '原始文件已保留'}"
            for item in report.attachment_summary.attachments
        )
    else:
        lines.append("无")
    lines.extend(["", "跨模块问题"])
    lines.extend([f"- {item['case_number']}：{item['message']}" for item in data["cross_module_issues"]] or ["无"])
    return "\n".join(lines)


def render_html(report: FactReport) -> str:
    text = render_text(report)
    return f"<!doctype html><meta charset='utf-8'><title>事实报告</title><pre>{html.escape(text)}</pre>"
