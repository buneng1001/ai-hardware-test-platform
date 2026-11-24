"""报告分析的分批执行、二分降级和检查点恢复。"""

import json
import threading
from collections.abc import Callable
from typing import Any

from app.ai_batching import BatchConfig, preflight_budget, split_batch
from app.fact_report_models import ProfessionalReportAnalysisOutput, ReportAnalysisOutput
from app.report_analysis_contract import PRIORITY_ORDER, professional_to_stored
from app.siliconflow import ModelErrorKind, SiliconFlowError

CANCEL_EVENTS: dict[int, threading.Event] = {}


def request_cancel(report_id: int) -> None:
    CANCEL_EVENTS.setdefault(report_id, threading.Event()).set()


def clear_cancel(report_id: int) -> None:
    CANCEL_EVENTS.pop(report_id, None)


def cancel_requested(report_id: int) -> bool:
    event = CANCEL_EVENTS.get(report_id)
    return bool(event and event.is_set())


def validate_report_output(raw_output: dict[str, Any], valid_refs: set[str]) -> ReportAnalysisOutput:
    output = ReportAnalysisOutput.model_validate(raw_output)
    items = [
        *output.risks,
        *output.additional_verifications,
        *output.regression_recommendations,
        output.stage_recommendation,
        *(output.test_directions or []),
    ]
    invalid_refs = sorted({ref for item in items for ref in item.evidence_refs if ref not in valid_refs})
    if invalid_refs:
        raise ValueError(f"包含无效事实引用：{', '.join(invalid_refs)}")
    return output


def validate_professional_output(raw_output: dict[str, Any], valid_refs: set[str]) -> ReportAnalysisOutput:
    output = professional_to_stored(ProfessionalReportAnalysisOutput.model_validate(raw_output))
    return validate_report_output(output.model_dump(), valid_refs)


def _aggregate(outputs: list[dict[str, Any]]) -> dict[str, Any]:
    if not outputs:
        raise ValueError("没有可汇总的分析批次")
    merged: dict[str, Any] = {
        "risks": [],
        "additional_verifications": [],
        "regression_recommendations": [],
        "stage_recommendation": outputs[0].get("stage_recommendation"),
    }
    for output in outputs:
        merged["risks"].extend(output.get("risks", []))
        merged["additional_verifications"].extend(output.get("additional_verifications", []))
        merged["regression_recommendations"].extend(output.get("regression_recommendations", []))
        if not merged["stage_recommendation"]:
            merged["stage_recommendation"] = output.get("stage_recommendation")
    if all(output.get("test_directions") is not None for output in outputs):
        # 合并相同方向，保留不同的测试思路；兼容字段仅保留优先的20项。
        directions = {}
        for output in outputs:
            for item in output["test_directions"]:
                key = tuple(item[field] for field in ("dimension", "title", "coverage_gap", "risk", "direction"))
                if key in directions:
                    current = directions[key]
                    current["evidence_refs"] = list(dict.fromkeys(current["evidence_refs"] + item["evidence_refs"]))[
                        :20
                    ]
                    if PRIORITY_ORDER[item["priority"]] < PRIORITY_ORDER[current["priority"]]:
                        current["priority"] = item["priority"]
                else:
                    directions[key] = dict(item)
        ordered = sorted(directions.values(), key=lambda item: PRIORITY_ORDER[item["priority"]])
        merged["test_directions"] = ordered
        merged["risks"] = [
            {"content": f"{item['title']}：{item['risk']}", "evidence_refs": item["evidence_refs"]}
            for item in ordered[:20]
        ]
        merged["additional_verifications"] = [
            {"content": f"{item['title']}：{item['direction']}", "evidence_refs": item["evidence_refs"]}
            for item in ordered[:20]
        ]
        unique_regression = {}
        for item in merged["regression_recommendations"]:
            unique_regression.setdefault((item["content"], tuple(item["evidence_refs"])), item)
        merged["regression_recommendations"] = list(unique_regression.values())[:20]
        stages = list(
            dict.fromkeys(
                output["stage_recommendation"]["suggestion"] + "：" + output["stage_recommendation"]["content"]
                for output in outputs
            )
        )
        if len(stages) > 1:
            joined = "；".join(stages)
            merged["stage_recommendation"] = {
                "suggestion": "多批次分析：综合各批次证据，优先处理高优先级测试方向。",
                "content": joined[:970] + ("…（其余请见各测试方向）" if len(joined) > 970 else ""),
                "evidence_refs": list(
                    dict.fromkeys(ref for output in outputs for ref in output["stage_recommendation"]["evidence_refs"])
                )[:20],
            }
    return merged


def run_batches(
    batches: list[dict[str, Any]],
    *,
    call_model: Callable[[dict[str, Any]], dict[str, Any]],
    valid_refs: set[str],
    checkpoints,
    config: BatchConfig,
    cancel_event: Callable[[], bool] | None = None,
) -> ReportAnalysisOutput:
    """按语义批次执行；截断时二分，恢复时复用已完成检查点。"""
    calls = 0
    cancelled = cancel_event or (lambda: False)

    def process(batch: dict[str, Any], attempt: int = 0) -> dict[str, Any]:
        nonlocal calls
        if cancelled():
            raise SiliconFlowError(
                ModelErrorKind.CONNECTION,
                "报告分析已取消",
                False,
                stage="report_analysis",
                action="检查点已保留，可稍后恢复",
            )
        cached = checkpoints.get(batch["key"])
        if cached is not None:
            # A checkpoint must remain structurally valid; a corrupt or partial
            # persisted output is not evidence of a completed semantic unit.
            try:
                validate_report_output(cached, set(batch["refs"]))
                return cached
            except (ValueError, TypeError, KeyError):
                pass
        preflight_budget(json.dumps(batch, ensure_ascii=False), config)
        if calls >= config.call_limit:
            raise SiliconFlowError(
                ModelErrorKind.CONNECTION,
                f"已达单次运行调用上限（{config.call_limit}）",
                False,
                stage="report_analysis",
                action="缩小分析范围或提高调用上限后重试",
            )
        calls += 1
        try:
            raw = call_model(batch)
            output = validate_report_output(raw, set(batch["refs"]))
            payload = output.model_dump()
            checkpoints.save(batch["key"], "completed", payload, None, attempt + 1)
            return payload
        except SiliconFlowError as error:
            if error.kind == ModelErrorKind.OUTPUT_TRUNCATED:
                parts = split_batch(batch)
                if parts is None:
                    checkpoints.save(batch["key"], "failed", None, str(error), attempt + 1)
                    raise SiliconFlowError(
                        ModelErrorKind.OUTPUT_TRUNCATED,
                        "单个语义单元仍被截断，请缩小范围或更换模型",
                        False,
                        stage="report_analysis",
                        action="缩小到更小语义单元或更换更大输出上限的模型",
                        diagnostic=json.dumps(
                            {"steps": ["truncated", "single_unit"], "error": str(error)},
                            ensure_ascii=False,
                        ),
                    ) from error
                results = [process(part, attempt + 1) for part in parts]
                merged = _aggregate(results)
                checkpoints.save(batch["key"], "completed", merged, None, attempt + 1)
                return merged
            checkpoints.save(batch["key"], "failed", None, str(error), attempt + 1)
            raise

    outputs = [process(batch) for batch in batches]
    return validate_report_output(
        _aggregate(outputs), valid_refs | {ref for batch in batches for ref in batch.get("refs", [])}
    )
