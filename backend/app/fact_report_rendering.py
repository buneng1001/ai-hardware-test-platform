"""将事实报告快照渲染为保持同一结论顺序的可下载格式。"""

import html

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


def _escape(value: object) -> str:
    return html.escape(str(value if value is not None else ""))


def _list(items: list[str], empty: str = "无") -> str:
    if not items:
        return f"<p class='muted'>{_escape(empty)}</p>"
    return "<ul>" + "".join(f"<li>{item}</li>" for item in items) + "</ul>"


STYLE = """
body { margin: 0; padding: 32px 40px 80px; max-width: 980px; color: #182632;
       font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; line-height: 1.7; }
h1 { margin: 0 0 8px; font-size: 1.7rem; }
h2 { margin: 36px 0 12px; font-size: 1.2rem; border-bottom: 1px solid #e2e8ee; padding-bottom: 6px; }
h3 { margin: 22px 0 8px; font-size: 1rem; }
p.muted { color: #64748b; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; font-size: 0.9rem; }
th, td { padding: 8px 10px; border: 1px solid #e2e8ee; text-align: left; vertical-align: top; }
th { background: #f3f6f8; color: #475569; font-weight: 600; }
ul { margin: 8px 0 16px; padding-left: 20px; }
li { margin: 4px 0; }
.rate { font-size: 1.6rem; font-weight: 700; color: #08786f; }
/* 可折叠目录：默认收起，固定在右上角，不挡正文。 */
.toc { position: fixed; top: 16px; right: 16px; z-index: 10; font-size: 0.88rem; }
.toc > summary { padding: 8px 14px; border: 1px solid #cbd5e1; border-radius: 10px;
                 background: #fff; box-shadow: 0 4px 14px rgb(20 34 50 / 12%); cursor: pointer; }
.toc[open] > summary { border-radius: 10px 10px 0 0; }
.toc ol { margin: 0; padding: 10px 16px 10px 14px; max-height: 60vh; overflow: auto;
          list-style: none;
          border: 1px solid #cbd5e1; border-top: 0; border-radius: 0 0 10px 10px;
          background: #fff; box-shadow: 0 8px 20px rgb(20 34 50 / 12%); }
.toc ol ol { max-height: none; overflow: visible; padding: 6px 0 2px 20px;
             border: 0; box-shadow: none; list-style: decimal; font-size: 0.82rem; }
.toc a { color: #0f766e; text-decoration: none; }
.toc a:hover { text-decoration: underline; }
.toc .sub { padding-left: 14px; }
@media print { .toc { display: none; } }
"""


def render_html(report: FactReport) -> str:
    """生成带可折叠目录的 HTML：目录固定在右上角，按需展开，不占正文空间。"""
    data = report.snapshot
    basic = data["basic_information"]
    pass_rate = data.get("pass_rate", {})
    issues = data.get("issues", {})
    overall = pass_rate.get("overall", {})

    toc: list[tuple[str, str]] = [
        ("basic", "一、测试基本信息"),
        ("overview", "二、总体结论与通过率"),
        ("modules", "三、模块汇总"),
        ("failed", "四、未通过用例"),
        ("blocked", "五、阻塞与未执行"),
        ("methods", "六、执行方式通过率"),
        ("details", "七、模块明细"),
        ("ai", "八、AI 分析"),
        ("appendix", "九、附录"),
    ]

    basic_rows = "".join(
        f"<tr><th>{_escape(key)}</th><td>{_escape(value)}</td></tr>"
        for key, value in basic.items()
        if value is not None and key != "product_profile"
    )
    profile_block = "".join(f"<p>{_escape(line)}</p>" for line in _profile_lines(basic.get("product_profile")))

    module_rows = []
    for index, module in enumerate(data.get("module_summary", []), start=1):
        counts = module["counts"]
        module_rate = module.get("pass_rate", {}).get("rate")
        module_rows.append(
            "<tr>"
            f"<td>{index}</td><td>{_escape(module['name'])}</td>"
            f"<td>{sum(counts.values())}</td><td>{counts['passed']}</td>"
            f"<td>{counts['failed']}</td><td>{counts['blocked']}</td>"
            f"<td>{counts['not_executed']}</td>"
            f"<td>{'—' if module_rate is None else f'{module_rate}%'}</td>"
            f"<td>{_escape(module['conclusion'])}</td></tr>"
        )

    failed_items = [
        f"<strong>{_escape(item['case_number'])}</strong> {_escape(item['title'])}"
        f"（{_escape(item['module'])}）：{_escape(item['actual_result'])}"
        for item in issues.get("failed", [])
    ]
    blocked_items = [
        f"<strong>{_escape(item['case_number'])}</strong> {_escape(item['title'])}"
        f"（{_escape(STATUS_LABELS.get(item['status'], item['status']))}）：{_escape(item['actual_result'])}"
        for item in issues.get("blocked", []) + issues.get("not_executed", [])
    ]

    module_details = []
    for index, module in enumerate(data.get("modules", []), start=1):
        records = "".join(
            "<li>"
            f"<strong>{_escape(item['case_number'])}</strong> {_escape(item['title'])}："
            f"{_escape(item['source'])} {_escape(STATUS_LABELS.get(item['status'], item['status']))}"
            f"{_escape('；' + item['result_consistency']) if item.get('result_consistency') else ''}；"
            f"{_escape(item['message'])}"
            "</li>"
            for item in module["records"]
        )
        module_details.append(
            f"<h3 id='module-{index}'>{_escape(module['name'])}"
            f"<span class='muted'>（{_escape(module['conclusion'])}）</span></h3><ul>{records}</ul>"
        )

    ai_lines: list[str] = [f"<p>{_escape(report.analysis.message)}</p>"]
    if report.analysis.output:
        output = report.analysis.output
        ai_lines.append("<h3>AI 阶段建议</h3>")
        ai_lines.append(f"<p>{_escape(output.stage_recommendation.suggestion)}</p>")
        for title, entries in (
            ("AI 高风险问题", output.risks),
            ("AI 补充验证", output.additional_verifications),
            ("AI 回归建议", output.regression_recommendations),
        ):
            ai_lines.append(f"<h3>{_escape(title)}</h3>")
            ai_lines.append(_list([_escape(entry.content) for entry in entries]))

    attachments = [item.filename for item in report.attachment_summary.attachments]
    appendix = [
        "<h3>附件</h3>",
        _list([_escape(name) for name in attachments], "无"),
        "<h3>跨模块问题</h3>",
        _list(
            [
                f"<strong>{_escape(item['case_number'])}</strong>：{_escape(item['message'])}"
                for item in data.get("cross_module_issues", [])
            ],
        ),
    ]

    module_toc = "".join(
        f"<li><a href='#module-{index}'>{_escape(module['name'])}</a></li>"
        for index, module in enumerate(data.get("modules", []), start=1)
    )
    toc_items = "".join(
        (
            f"<li><a href='#{anchor}'>{_escape(title)}</a>"
            + (f"<ol>{module_toc}</ol>" if anchor == "details" else "")
            + "</li>"
        )
        for anchor, title in toc
    )

    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>{_escape(basic.get("project_name", ""))} 测试报告</title>
<style>{STYLE}</style></head>
<body>
<details class="toc"><summary>目录</summary>
<ol>{toc_items}</ol>
</details>

<h1>{_escape(basic.get("project_name", ""))} 测试报告</h1>
<p class="muted">{_escape(basic.get("product_name", ""))} · {_escape(basic.get("product_version", ""))}
 · {_escape(basic.get("test_group", ""))} · 生成时间 {_escape(str(basic.get("generated_at", ""))[:16])}</p>

<h2 id="basic">一、测试基本信息</h2>
<table>{basic_rows}</table>
{profile_block}

<h2 id="overview">二、总体结论与通过率</h2>
<p class="rate">{_escape("无可统计结果" if overall.get("rate") is None else f"{overall.get('rate')}%")}</p>
<p>通过 {_escape(overall.get("passed", 0))} / 已测 {_escape(overall.get("tested", 0))}
 · 共 {_escape(overall.get("total", 0))} 条 · 未执行 {_escape(overall.get("not_executed", 0))} 条</p>
<p>阶段结论：{_escape(data["stage_progress"]["conclusion"])}</p>
{_list([_escape(item) for item in data["stage_progress"]["basis"]])}

<h2 id="modules">三、模块汇总</h2>
<table><tr><th>编号</th><th>模块</th><th>用例数</th><th>通过</th><th>失败</th><th>阻塞</th>
<th>未执行</th><th>通过率</th><th>结论</th></tr>{"".join(module_rows)}</table>

<h2 id="failed">四、未通过用例</h2>
{_list(failed_items, "没有未通过用例。")}

<h2 id="blocked">五、阻塞与未执行</h2>
{_list(blocked_items)}

<h2 id="methods">六、执行方式通过率</h2>
<p>自动化：{_escape(_rate_text(pass_rate.get("automation")))}</p>
<p>人工：{_escape(_rate_text(pass_rate.get("manual")))}</p>

<h2 id="details">七、模块明细</h2>
{"".join(module_details)}

<h2 id="ai">八、AI 分析</h2>
{"".join(ai_lines)}

<h2 id="appendix">九、附录</h2>
{"".join(appendix)}
</body></html>"""
