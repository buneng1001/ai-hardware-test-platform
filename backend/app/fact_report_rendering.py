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


def _rate_text(block: dict[str, object] | None) -> str:
    if not block:
        return "无数据"
    rate = block.get("rate")
    rate_text = f"{rate}%" if rate is not None else "无可统计结果"
    return (
        f"{rate_text}（通过 {block.get('passed', 0)} / 已测 {block.get('tested', 0)}，"
        f"未执行 {block.get('not_executed', 0)}）"
    )


def _profile_lines(profile: object) -> list[str]:
    """把产品画像写成报告里的可读描述。"""
    if not isinstance(profile, dict):
        return []
    parts = [
        f"实体按键 {profile.get('physical_keys', 0)} 个",
        f"指示灯 {profile.get('indicator_lights', 0)} 个",
        f"摄像头 {profile.get('cameras', 0)} 个",
        f"麦克风{'有' if profile.get('microphone') else '无'}",
        f"提示音{'有' if profile.get('buzzer') else '无'}",
    ]
    lines = [f"产品形态：{' · '.join(parts)}"]
    if profile.get("interfaces"):
        lines.append(f"通信接口：{profile['interfaces']}")
    if profile.get("test_environment"):
        lines.append(f"测试环境：{profile['test_environment']}")
    platform = {"web": "网页 / 后台", "app": "手机 App"}.get(str(profile.get("platform")), "无")
    detail = profile.get("web_url") or profile.get("app_package") or ""
    lines.append(f"测试平台：{platform}{f'（{detail}）' if detail else ''}")
    return lines


def render_text(report: FactReport) -> str:
    data = report.snapshot
    basic = data["basic_information"]
    pass_rate = data.get("pass_rate", {})
    issues = data.get("issues", {})
    lines = [
        "一、测试基本信息",
        *(f"{key}：{value}" for key, value in basic.items() if value is not None and key != "product_profile"),
        *(_profile_lines(basic.get("product_profile"))),
        "",
        "二、总体结论与通过率",
        f"总体通过率：{_rate_text(pass_rate.get('overall'))}",
        f"阶段结论：{data['stage_progress']['conclusion']}",
        *data["stage_progress"]["basis"],
        "",
        "三、模块汇总",
        "编号 | 模块 | 用例数 | 通过 | 失败 | 阻塞 | 未执行 | 通过率 | 结论",
    ]
    for index, module in enumerate(data.get("module_summary", []), start=1):
        counts = module["counts"]
        module_rate = module.get("pass_rate", {}).get("rate")
        rate_text = f"{module_rate}%" if module_rate is not None else "—"
        lines.append(
            f"{index} | {module['name']} | {sum(counts.values())} | "
            f"{counts['passed']} | {counts['failed']} | {counts['blocked']} | "
            f"{counts['not_executed']} | {rate_text} | {module['conclusion']}"
        )

    lines.extend(["", "四、未通过用例"])
    failed = issues.get("failed", [])
    lines.extend(
        [f"- {item['case_number']} {item['title']}（{item['module']}）：{item['actual_result']}" for item in failed]
        or ["无"]
    )

    lines.extend(["", "五、阻塞与未执行"])
    for label, key in (("阻塞", "blocked"), ("未执行", "not_executed")):
        items = issues.get(key, [])
        lines.append(f"{label}：{len(items)} 条")
        lines.extend(f"- {item['case_number']} {item['title']}：{item['actual_result']}" for item in items)

    lines.extend(
        [
            "",
            "六、执行方式通过率",
            f"自动化：{_rate_text(pass_rate.get('automation'))}",
            f"人工：{_rate_text(pass_rate.get('manual'))}",
            "",
            "七、模块明细",
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

    lines.extend(["", "八、AI 分析", report.analysis.message])
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

    lines.extend(["", "九、附录"])
    lines.append("附件使用状态")
    if report.attachment_summary.attachments:
        # 附录只列文件名，不嵌入附件内容。
        lines.extend(f"- {item.filename}" for item in report.attachment_summary.attachments)
    else:
        lines.append("无")
    lines.append("跨模块问题")
    lines.extend([f"- {item['case_number']}：{item['message']}" for item in data["cross_module_issues"]] or ["无"])
    return "\n".join(lines)


def render_html(report: FactReport) -> str:
    text = render_text(report)
    return f"<!doctype html><meta charset='utf-8'><title>事实报告</title><pre>{html.escape(text)}</pre>"
