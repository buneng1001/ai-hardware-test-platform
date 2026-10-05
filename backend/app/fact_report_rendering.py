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
        data["ai_analysis"]["message"],
        "",
        "范围总览",
        json.dumps(data["scope_overview"], ensure_ascii=False),
        "",
        "模块详情",
    ]
    for module in data["modules"]:
        lines.extend([f"\n模块：{module['name']}", f"当前事实结论：{module['conclusion']}"])
        for item in module["records"]:
            consistency = f"；{item['result_consistency']}" if item.get("result_consistency") else ""
            result = STATUS_LABELS[item["status"]]
            lines.append(
                f"- {item['case_number']} {item['title']}：{item['source']} {result}{consistency}；{item['message']}"
            )
    lines.extend(["", "跨模块问题"])
    lines.extend([f"- {item['case_number']}：{item['message']}" for item in data["cross_module_issues"]] or ["无"])
    return "\n".join(lines)


def render_html(report: FactReport) -> str:
    text = render_text(report)
    return f"<!doctype html><meta charset='utf-8'><title>事实报告</title><pre>{html.escape(text)}</pre>"
