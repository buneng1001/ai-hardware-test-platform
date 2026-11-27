"""报告 AI 契约回归：真实 Schema、有限修复、明确事实引用。"""

import json
import sqlite3

import pytest

from app.ai_batching import BatchConfig, semantic_batches, split_batch
from app.ai_invocation import AiInvocationCancelled
from app.fact_report_models import ProfessionalReportAnalysisOutput, ReportAnalysisOutput
from app.report_analysis import _generate_validated_output
from app.report_analysis_batching import validate_professional_output
from app.report_analysis_contract import (
    BATCH_PROMPT_VERSION,
    REPAIR_PROMPT_VERSION,
    REPORT_PROMPT_VERSION,
    missing_simulation_analysis,
    normalize_report_output,
    report_system_prompt,
)
from app.report_analysis_inputs import analysis_input, build_mock_analysis, source_catalog_context
from app.siliconflow import ModelErrorKind, SiliconFlowError
from app.structured_repair import RepairBudget


class Lease:
    cancelled = False

    def cancel_requested(self):
        return self.cancelled


class Adapter:
    max_calls = 10

    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []
        self.call_count = 0

    def generate_json(self, **kwargs):
        self.calls.append(kwargs)
        self.call_count += 1
        return next(self.responses)


def output(ref="record:0:0"):
    return {
        "test_directions": [
            {
                "dimension": "functional",
                "priority": "high",
                "title": "功能复核",
                "coverage_gap": "仅包含当前记录",
                "risk": "覆盖有限",
                "direction": "复核记录",
                "evidence_refs": [ref],
            }
        ],
        "regression_recommendations": [],
        "stage_recommendation": {
            "suggestion": "人工复核",
            "content": "建议仅供参考",
            "evidence_refs": ["stage_progress"],
        },
    }


def invoke(adapter, *, batch=False, budget=None, lease=None):
    return _generate_validated_output(
        adapter=adapter,
        api_key="fake-key",
        model="test-model",
        data={"stage_progress": {"conclusion": "事实"}, "modules": []},
        refs={"stage_progress", "record:0:0"},
        config=BatchConfig(),
        lease=lease or Lease(),
        repair_budget=budget or RepairBudget(10),
        batch=batch,
    )


@pytest.mark.parametrize("batch", [False, True])
def test_prompt_uses_schema_and_exact_reference_allowlist(batch):
    adapter = Adapter([output()])
    result = invoke(adapter, batch=batch)
    assert result.test_directions == ProfessionalReportAnalysisOutput.model_validate(output()).test_directions
    assert result.risks[0].content == "功能复核：覆盖有限"
    assert result.additional_verifications[0].content == "功能复核：复核记录"
    assert len(adapter.calls) == 1
    call = adapter.calls[0]
    assert call["prompt_version"] == (BATCH_PROMPT_VERSION if batch else REPORT_PROMPT_VERSION)
    schema = json.loads(call["system_prompt"].split("输出契约 JSON Schema：")[1])
    assert schema == ProfessionalReportAnalysisOutput.model_json_schema()
    assert set(schema["required"]) == set(output())
    assert json.loads(call["evidence_json"])["allowed_evidence_refs"] == ["record:0:0", "stage_progress"]


def test_professional_analysis_prompt_requires_coverage_and_conditional_regression():
    for batch in (False, True):
        prompt = report_system_prompt(batch=batch)
        for requirement in (
            "资深智能硬件/嵌入式系统测试工程师",
            "跨功能交互",
            "覆盖缺口",
            "data_driven_simulation",
            "优先级",
            "不编写测试步骤",
            "目录未纳入本报告不代表未执行或失败",
            "边界值",
            "运行安全",
            "条件式回归建议",
            "不能断言整个项目从未测试",
            "独立于确定性阶段结论",
            "module:N 或 record:N:M",
        ):
            assert requirement in prompt


def test_mock_report_analysis_emits_module_specific_regression_seeds():
    output = build_mock_analysis(
        {
            "modules": [
                {
                    "ref": "module:0",
                    "name": "蓝牙连接",
                    "records": [
                        {
                            "ref": "record:0:0",
                            "case_number": "BT-001",
                            "status": "failed",
                        }
                    ],
                },
                {"ref": "module:1", "name": "无执行记录模块", "records": []},
            ]
        }
    )
    assert len(output.regression_recommendations) == 1
    assert output.regression_recommendations[0].evidence_refs == ["record:0:0"]
    assert output.test_directions[0].evidence_refs == ["record:0:0"]


def test_simulation_mode_and_profile_references_survive_batching():
    data, refs = analysis_input(
        {
            "modules": [],
            "cross_module_issues": [],
            "stage_progress": {"conclusion": "建议进入下一阶段"},
            "scope_overview": {"automation_case_count": 3, "manual_case_count": 0},
            "basic_information": {
                "product_name": "双摄设备",
                "automation_execution": {"execution_mode": "data_driven_simulation"},
                "manual_batches": [],
            },
        }
    )
    assert {"execution_context", "scope_overview"} <= refs
    data["product_profile"] = {"physical_keys": 2, "cameras": 2}
    batch = semantic_batches(data, BatchConfig())[0]
    assert batch["execution_context"]["automation_execution"]["execution_mode"] == "data_driven_simulation"
    assert {"product_profile", "execution_context", "scope_overview"} <= set(batch["refs"])
    raw = output()
    raw["test_directions"] = []
    assert missing_simulation_analysis(validate_professional_output(raw, refs), data)
    raw = output("execution_context")
    assert not missing_simulation_analysis(validate_professional_output(raw, refs), data)


def test_deterministic_normalization_needs_no_second_model_request():
    raw = output()
    raw["test_directions"][0]["evidence_refs"] = "record:0:0"
    adapter = Adapter([raw])
    assert invoke(adapter).test_directions[0].direction == "复核记录"
    assert len(adapter.calls) == 1
    assert raw["test_directions"][0]["evidence_refs"] == "record:0:0"


@pytest.mark.parametrize("ref", ["invented", None])
def test_missing_or_unknown_evidence_is_not_fabricated(ref):
    raw = output()
    if ref:
        raw["test_directions"][0]["evidence_refs"] = [ref]
    else:
        raw["test_directions"][0].pop("evidence_refs")
    with pytest.raises(ValueError):
        validate_professional_output(normalize_report_output(raw), {"stage_progress", "record:0:0"})


def test_repair_uses_same_schema_without_reinjecting_bad_output():
    raw = output()
    raw["stage_recommendation"] = {"secret_payload_marker": "do-not-echo", "evidence_refs": ["stage_progress"]}
    adapter = Adapter([raw, output()])
    assert invoke(adapter).stage_recommendation.suggestion == "人工复核"
    assert len(adapter.calls) == 2
    repair = adapter.calls[1]
    assert repair["prompt_version"] == REPAIR_PROMPT_VERSION
    assert repair["system_prompt"] == report_system_prompt(repair=True)
    data = json.loads(repair["evidence_json"])
    assert "secret_payload_marker" not in repair["evidence_json"]
    assert data["allowed_evidence_refs"] == ["record:0:0", "stage_progress"]
    assert data["report_input"]["allowed_evidence_refs"] == data["allowed_evidence_refs"]


def test_repair_budget_shared_across_batches_and_invalid_result_stays_failed():
    budget = RepairBudget(10)
    bad = {"risks": []}
    first = Adapter([bad, output()])
    invoke(first, batch=True, budget=budget)
    second = Adapter([bad])
    with pytest.raises(SiliconFlowError) as caught:
        invoke(second, batch=True, budget=budget)
    assert caught.value.kind == ModelErrorKind.SCHEMA_VALIDATION
    assert len(second.calls) == 1


def test_cancelled_before_model_request():
    lease = Lease()
    lease.cancelled = True
    adapter = Adapter([])
    with pytest.raises(AiInvocationCancelled):
        invoke(adapter, lease=lease)
    assert not adapter.calls


def test_batch_and_split_preserve_global_context_and_correct_refs():
    data = {
        "stage_progress": {"conclusion": "事实"},
        "scope_overview": {"total": 3},
        "historical_reports": [{"ref": "history_report:7", "report_id": 7}],
        "cross_module_issues": [{"ref": "cross_issue:0"}],
        "product_profile": {"physical_keys": 3},
        "version_ai_context": "补充说明",
        "modules": [
            {"ref": "module:0", "records": [{"ref": "record:0:0"}, {"ref": "record:0:1"}]},
            {"ref": "module:1", "records": [{"ref": "record:1:0"}]},
        ],
    }
    batches = semantic_batches(data, BatchConfig(modules_per_batch=1))
    assert len(batches) == 2
    for batch in batches:
        for field in (
            "scope_overview",
            "historical_reports",
            "cross_module_issues",
            "product_profile",
            "version_ai_context",
        ):
            assert batch[field] == data[field]
        assert {"history_report:7", "cross_issue:0", "stage_progress"} <= set(batch["refs"])
    first, second = split_batch(batches[0])
    assert "record:0:0" in first["refs"] and "record:0:1" not in first["refs"]
    assert "record:0:1" in second["refs"] and "record:0:0" not in second["refs"]
    assert {"history_report:7", "cross_issue:0"} <= set(second["refs"])


def test_legacy_saved_analysis_still_readable():
    legacy = {
        "risks": [],
        "additional_verifications": [],
        "regression_recommendations": [],
        "stage_recommendation": output()["stage_recommendation"],
    }
    assert ReportAnalysisOutput.model_validate(legacy).test_directions is None
    with pytest.raises(ValueError):
        validate_professional_output(legacy, {"stage_progress"})


def test_catalog_only_current_version_and_no_execution_fields():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute(
        "CREATE TABLE source_test_cases (id, product_version_id, case_number, title, "
        "module, test_type, test_item, test_result)"
    )
    connection.executemany(
        "INSERT INTO source_test_cases VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (1, 11, "A", "按键A", "按键", "功能", "按键A", "passed"),
            (2, 11, "B", "按键B", "按键", "功能", "按键B", "failed"),
            (3, 12, "C", "另一版本", "其他", "功能", "其他", "passed"),
        ],
    )
    data = {"modules": [{"name": "按键", "records": [{"case_number": "A", "status": "passed"}]}]}
    result = source_catalog_context(connection, 11, data)
    assert result["defined_count"] == 2
    assert result["matching_report_number_count"] == 1
    encoded = json.dumps(result, ensure_ascii=False)
    assert "按键B" in encoded
    assert "另一版本" not in encoded
    assert "failed" not in encoded and "passed" not in encoded
    data["source_catalog"] = result
    data["stage_progress"] = {}
    batch = semantic_batches(data, BatchConfig())[0]
    assert batch["source_catalog"] == result
    assert "source_catalog" in batch["refs"]
