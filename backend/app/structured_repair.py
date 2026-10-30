"""结构化输出修复层级：去包装、Schema 校验、本地归一化、一次受约束修复。"""

import json
from collections.abc import Callable

from pydantic import ValidationError

from app.siliconflow import ModelErrorKind, SiliconFlowError

REPAIR_CONTEXT_MARKER = "[REPAIR-CONTEXT-ONLY]"


def strip_wrappers(value: str | dict[str, object]) -> dict[str, object]:
    """只处理 Markdown 围栏和 diagnosis/result/data 外层包装。"""
    if isinstance(value, dict):
        return _unwrap(value)
    cleaned = value.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```")
        if cleaned.startswith("json"):
            cleaned = cleaned.removeprefix("json")
        cleaned = cleaned.removesuffix("```").strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise SiliconFlowError(
            ModelErrorKind.MALFORMED_RESPONSE,
            "模型输出不是合法 JSON",
            False,
            diagnostic="json_decode_failed",
        ) from error
    if not isinstance(parsed, dict):
        raise SiliconFlowError(
            ModelErrorKind.MALFORMED_RESPONSE,
            "模型 JSON 顶层必须是对象",
            False,
        )
    return _unwrap(parsed)


def _unwrap(value: dict[str, object]) -> dict[str, object]:
    for wrapper in ("diagnosis", "result", "data"):
        wrapped = value.get(wrapper)
        if isinstance(wrapped, dict):
            return wrapped
    return value


def normalize_refs(raw: dict[str, object], fallback_ref: str) -> dict[str, object]:
    """只给缺失的证据引用补一个本次输入中唯一可推导的引用，不伪造业务事实。"""
    normalized = json.loads(json.dumps(raw))
    for value in normalized.values():
        if not isinstance(value, list):
            continue
        for item in value:
            if isinstance(item, dict) and "evidence_refs" in item and not item.get("evidence_refs"):
                item["evidence_refs"] = [fallback_ref]
    return normalized


def _short_error(text: str) -> str:
    """错误文本去掉 Pydantic 附带的输入值，避免回灌失败输出。"""
    lines = [line.strip() for line in text.splitlines() if "input_value" not in line and "input_type" not in line]
    return " ".join(line for line in lines if line)[:300]


def repair_prompt(errors: list[str], allowed_refs: list[str], fields: list[str]) -> str:
    """只包含缺失字段、合法范围和必要错误，不回灌整段失败输出。"""
    return (
        f"{REPAIR_CONTEXT_MARKER}\n"
        "只返回修复后的 JSON 对象；不要输出解释、Markdown 或原输入。\n"
        f"需要修复的字段：{', '.join(fields)}\n"
        f"合法 evidence_refs 范围：{', '.join(allowed_refs)}\n"
        f"校验错误：{'；'.join(errors)}\n"
        "不得新增、删除或改写业务事实；无法修复时返回 {}。"
    )


class RepairBudget:
    """修复调用有独立上限，并计入总调用上限。"""

    def __init__(self, remaining_calls: int, max_repairs: int = 1) -> None:
        self.remaining_calls = max(0, remaining_calls)
        self.max_repairs = max_repairs
        self.repairs_used = 0

    def can_repair(self) -> bool:
        return self.remaining_calls > 0 and self.repairs_used < self.max_repairs

    def consume(self) -> None:
        self.remaining_calls -= 1
        self.repairs_used += 1


def run_repair_ladder(
    raw: str | dict[str, object],
    *,
    validate: Callable[[dict[str, object]], object],
    normalize: Callable[[dict[str, object]], dict[str, object]] | None = None,
    repair: Callable[[str], str] | None = None,
    budget: RepairBudget | None = None,
    fallback_ref: str = "stage_progress",
    fields: list[str] | None = None,
    allowed_refs: list[str] | None = None,
) -> tuple[object, list[str]]:
    """固定顺序修复；任一步成功即停止，最终失败保留步骤与错误证据。"""
    steps = ["unwrap"]
    stripped = strip_wrappers(raw)
    try:
        return validate(stripped), steps
    except (ValidationError, ValueError) as error:
        first_errors = [_short_error(str(error))]
    if normalize is not None:
        steps.append("normalize")
        try:
            return validate(normalize(stripped)), steps
        except (ValidationError, ValueError) as error:
            first_errors.append(_short_error(str(error)))
    if repair is not None and budget is not None and budget.can_repair():
        budget.consume()
        steps.append("repair")
        prompt = repair_prompt(
            first_errors,
            allowed_refs or [fallback_ref],
            fields or ["输出字段"],
        )
        repaired_text = repair(prompt)
        if REPAIR_CONTEXT_MARKER in repaired_text:
            raise SiliconFlowError(
                ModelErrorKind.MALFORMED_RESPONSE,
                "模型回显了修复上下文，已停止自动修复",
                False,
                diagnostic=json.dumps({"steps": steps}, ensure_ascii=False),
            )
        try:
            return validate(strip_wrappers(repaired_text)), steps
        except (ValidationError, ValueError) as error:
            first_errors.append(_short_error(str(error)))
    raise SiliconFlowError(
        ModelErrorKind.SCHEMA_VALIDATION,
        "模型输出未通过结构化校验",
        False,
        diagnostic=json.dumps({"steps": steps, "errors": first_errors[:5]}, ensure_ascii=False),
    )
