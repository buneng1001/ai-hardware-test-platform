import json

import pytest
from pydantic import BaseModel, Field, model_validator

from app.siliconflow import ModelErrorKind, SiliconFlowError
from app.structured_repair import (
    REPAIR_CONTEXT_MARKER,
    RepairBudget,
    normalize_refs,
    repair_prompt,
    run_repair_ladder,
    strip_wrappers,
)


class Item(BaseModel):
    content: str = Field(min_length=1)
    evidence_refs: list[str] = Field(min_length=1)


class Output(BaseModel):
    items: list[Item] = Field(min_length=1)

    @model_validator(mode="after")
    def valid_refs(self):
        allowed = {"ref", "stage_progress"}
        for item in self.items:
            if any(ref not in allowed for ref in item.evidence_refs):
                raise ValueError("invalid evidence ref")
        return self


def validate(data):
    return Output.model_validate(data)


def test_wrappers_are_removed_and_truncation_is_not_malformed():
    assert strip_wrappers('```json\n{"result": {"items": [{"content": "ok", "evidence_refs": ["ref"]}]}}\n```') == {
        "items": [{"content": "ok", "evidence_refs": ["ref"]}]
    }
    with pytest.raises(SiliconFlowError) as malformed:
        strip_wrappers('{"items": [')
    assert malformed.value.kind == ModelErrorKind.MALFORMED_RESPONSE
    assert malformed.value.kind != ModelErrorKind.OUTPUT_TRUNCATED


def test_normalization_only_fills_missing_refs():
    normalized = normalize_refs({"items": [{"content": "ok", "evidence_refs": []}]}, "stage_progress")
    assert normalized["items"][0]["evidence_refs"] == ["stage_progress"]
    untouched = normalize_refs(
        {"items": [{"content": "ok", "evidence_refs": ["invented"]}]},
        "stage_progress",
    )
    assert untouched["items"][0]["evidence_refs"] == ["invented"]


def test_repair_ladder_prefers_normalization_then_one_repair():
    calls = 0

    def repair(prompt):
        nonlocal calls
        calls += 1
        assert "items" in prompt
        assert "stage_progress" in prompt
        assert "failed-output" not in prompt
        return json.dumps({"items": [{"content": "repaired", "evidence_refs": ["stage_progress"]}]})

    result, steps = run_repair_ladder(
        {"items": [{"content": "repaired", "evidence_refs": []}]},
        validate=validate,
        normalize=lambda data: normalize_refs(data, "stage_progress"),
        repair=repair,
        budget=RepairBudget(remaining_calls=5),
        allowed_refs=["stage_progress"],
        fields=["items"],
    )
    assert result.items[0].evidence_refs == ["stage_progress"]
    assert calls == 0
    assert steps == ["unwrap", "normalize"]


def test_repair_prompt_is_constrained_and_repair_budgeted():
    prompts: list[str] = []

    def repair(prompt):
        prompts.append(prompt)
        return json.dumps({"items": [{"content": "fixed", "evidence_refs": ["ref"]}]})

    budget = RepairBudget(remaining_calls=2)
    run_repair_ladder(
        {"items": [{"content": "bad", "evidence_refs": ["bad-ref"]}]},
        validate=validate,
        normalize=None,
        repair=repair,
        budget=budget,
        allowed_refs=["ref"],
        fields=["items"],
    )
    assert budget.repairs_used == 1
    assert REPAIR_CONTEXT_MARKER in prompts[0]
    assert "ref" in prompts[0]
    assert "bad-ref" not in prompts[0]


def test_repair_echo_is_rejected_without_another_call():
    def repair(prompt):
        return prompt

    with pytest.raises(SiliconFlowError) as captured:
        run_repair_ladder(
            {"items": []},
            validate=validate,
            normalize=None,
            repair=repair,
            budget=RepairBudget(remaining_calls=1),
            allowed_refs=["ref"],
            fields=["items"],
        )
    assert captured.value.kind == ModelErrorKind.MALFORMED_RESPONSE
    assert "回显" in str(captured.value)


def test_no_repair_budget_fails_with_schema_validation_and_steps():
    with pytest.raises(SiliconFlowError) as captured:
        run_repair_ladder(
            {"items": []},
            validate=validate,
            normalize=None,
            repair=lambda _prompt: "{}",
            budget=RepairBudget(remaining_calls=0),
        )
    assert captured.value.kind == ModelErrorKind.SCHEMA_VALIDATION
    detail = captured.value.diagnostic or ""
    assert "unwrap" in detail
    assert "errors" in detail


def test_repair_prompt_contains_only_fields_ranges_and_errors():
    prompt = repair_prompt(
        ["items.0.content 不能为空"],
        ["stage_progress", "record:0:0"],
        ["items"],
    )
    assert "items" in prompt
    assert "stage_progress" in prompt
    assert "items.0.content 不能为空" in prompt
    assert "原始输出" not in prompt
