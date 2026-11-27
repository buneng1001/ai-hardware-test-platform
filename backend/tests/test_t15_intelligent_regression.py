"""T15: AI-first, evidence-grounded regression planning from frozen report snapshots."""

import json

import pytest

from app import intelligent_regression as regression
from app.database import open_database
from app.fact_report_models import ReportAnalysis, ReportAnalysisOutput
from app.siliconflow import ModelErrorKind, SiliconFlowError
from tests import test_t05_report_ai_gate as t05
from tests.test_t13_report_source_snapshot import _batch, _create_group, _report

prepared = t05.prepared
enable_ai = t05.enable_ai


def endpoint(report):
    return f"/api/fact-reports/{report['id']}/intelligent-regression"


def ready(prepared, monkeypatch):
    client, _, _, _, report = prepared
    enable_ai(client, monkeypatch)
    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "mock")
    assert client.post(f"/api/fact-reports/{report['id']}/analysis").json()["status"] == "completed"
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "mock")

    recommendations = []
    directions = []
    risks = []
    for index, module in enumerate(report["snapshot"]["modules"]):
        if not module["records"]:
            continue
        reference = f"record:{index}:0"
        title = module["name"]
        recommendations.append(
            {
                "content": f"复测{title}中已验证的关键场景，确认本次发现不会在目标版本复现",
                "evidence_refs": [reference],
            }
        )
        directions.append(
            {
                "dimension": "functional",
                "priority": "high",
                "title": f"{title}关键场景复测",
                "coverage_gap": "确认已验证场景在目标版本中的表现",
                "risk": "来源报告记录了需要复核的测试结果",
                "direction": "复现来源场景并核对可观察结果",
                "evidence_refs": [reference],
            }
        )
        risks.append(
            {
                "content": f"{title}存在需要复核的测试结果",
                "evidence_refs": [reference],
            }
        )
    first_ref = recommendations[0]["evidence_refs"][0]
    analysis_output = ReportAnalysisOutput.model_validate(
        {
            "risks": risks,
            "additional_verifications": [],
            "regression_recommendations": recommendations,
            "stage_recommendation": {
                "suggestion": "优先复核报告中的回归风险",
                "content": "报告建议只是分析线索，需结合事实重新判断",
                "evidence_refs": [first_ref],
            },
            "test_directions": directions,
        }
    )
    completed_analysis = ReportAnalysis(
        status="completed",
        message="报告 AI 总体分析已完成",
        output=analysis_output,
    )
    monkeypatch.setattr(
        regression,
        "latest_analysis",
        lambda _connection, report_id: (
            completed_analysis
            if report_id == report["id"]
            else ReportAnalysis(status="not_enabled", message="辅助报告未进行 AI 总体分析", output=None)
        ),
    )
    return client, report


def _load_inputs(report):
    with open_database() as connection:
        inputs, catalogs = regression.load_inputs(connection, report["id"], [])
    return inputs, catalogs


def _first_module(payload):
    if payload.get("modules"):
        modules = payload["modules"]
        module = next((item for item in modules if item.get("records")), modules[0])
        return module["name"], module["ref"]
    analyses = payload.get("module_analyses") or []
    first = analyses[0]
    return first["module"], first["findings"][0]["evidence_refs"][0]["evidence_ref"]


def _global_output(report_id, payload, *, include_target=False, invalid_evidence=False):
    module_name, module_ref = _first_module(payload)
    main_refs = [{"report_id": report_id, "evidence_ref": module_ref}]
    analysis_refs = (
        [{"report_id": report_id, "evidence_ref": "not-a-real-reference"}] if invalid_evidence else main_refs
    )
    modules = []
    if payload.get("modules"):
        modules = [
            {
                "module": item["name"],
                "priority": "high",
                "reason": item.get("conclusion") or "报告事实支持定向回归。",
                "evidence_refs": [{"report_id": report_id, "evidence_ref": item["ref"]}],
            }
            for item in payload["modules"]
        ]
    else:
        seen = set()
        for item in payload.get("module_analyses") or []:
            if item["module"] in seen:
                continue
            seen.add(item["module"])
            ref = item["findings"][0]["evidence_refs"][0]["evidence_ref"]
            modules.append(
                {
                    "module": item["module"],
                    "priority": "high",
                    "reason": item["summary"] or "报告事实支持定向回归。",
                    "evidence_refs": [{"report_id": report_id, "evidence_ref": ref}],
                }
            )
    targets = []
    if include_target:
        targets = [
            {
                "module": module_name,
                "title": "录像异常恢复后的文件完整性",
                "test_item": "异常恢复与文件完整性",
                "priority": "high",
                "reason": "报告事实表明异常恢复路径存在回归风险。",
                "coverage_gap": "现有报告用例未独立验证恢复后的文件可读性和完整性。",
                "evidence_refs": main_refs,
            }
        ]
    return {
        "analysis_sections": {
            "regression_necessity": {
                "content": "需要针对已验证风险开展定向回归，不据此推断项目放行结论。",
                "evidence_refs": analysis_refs,
            },
            "impact_analysis": {
                "content": "从报告记录的异常结果分析模块影响，并核对关联路径。",
                "evidence_refs": main_refs,
            },
            "execution_strategy": {
                "content": "先复测已有用例，再补足经证据确认的覆盖缺口。",
                "evidence_refs": main_refs,
            },
            "execution_readiness": {
                "content": "执行前核对设备、版本、环境和数据；未提供的阈值不得自行编造。",
                "evidence_refs": main_refs,
            },
        },
        "key_changes": None,
        "summary": "已根据报告事实形成回归策略。",
        "modules": modules,
        "existing_case_recommendations": [],
        "new_case_targets": targets,
        "review_notes": [],
    }


def _module_output(payload, report_id):
    analyses = []
    for module in payload["modules"]:
        analyses.append(
            {
                "module": module["name"],
                "summary": module.get("conclusion") or "模块报告事实已分析。",
                "findings": [
                    {
                        "content": module.get("conclusion") or "模块报告事实已分析。",
                        "evidence_refs": [{"report_id": report_id, "evidence_ref": module["ref"]}],
                    }
                ],
                "existing_case_recommendations": [],
                "new_case_targets": [],
                "review_notes": [],
            }
        )
    return {"module_analyses": analyses}


def _detail_output(payload):
    candidates = []
    for target in payload["targets"]:
        candidates.append(
            {
                "target_id": target["target_id"],
                "title": target["title"],
                "case_type": "manual",
                "module": target["module"],
                "priority": target["priority"],
                "test_item": target["test_item"],
                "reason": target["reason"],
                "preconditions": "目标设备和软件版本已部署，测试环境与原报告保持可比。",
                "input": "使用报告中对应的设备、配置和测试数据。",
                "steps": "1. 准备目标版本和设备环境\n2. 执行目标异常恢复场景\n3. 检查恢复后的文件状态和可读性",
                "expected_result": "恢复过程符合产品规格，生成文件可读取且内容完整；未定义的数值阈值按产品规格评审。",
                "sources": target["evidence_refs"],
                "completion_status": "ready",
            }
        )
    return {"candidates": candidates, "deferred_targets": []}


def test_global_synthesis_merges_module_details_from_saved_checkpoints(prepared, monkeypatch):
    _, report = ready(prepared, monkeypatch)
    inputs, catalogs = _load_inputs(report)
    module = next(item for item in inputs["main"]["facts"]["modules"] if item["records"])
    record = module["records"][0]
    evidence = [{"report_id": report["id"], "evidence_ref": record["ref"]}]
    module_analysis = {
        "module": module["name"],
        "summary": "该模块存在需要优先验证的风险。",
        "findings": [{"content": "报告记录了需要复核的执行事实。", "evidence_refs": evidence}],
        "existing_case_recommendations": [
            {
                "module": module["name"],
                "case_number": record["case_number"],
                "priority": "high",
                "reason": "原用例曾出现异常结果，应按原定义复测。",
                "evidence_refs": evidence,
            }
        ],
        "new_case_targets": [
            {
                "module": module["name"],
                "title": "恢复后文件完整性检查",
                "test_item": "文件完整性",
                "priority": "high",
                "reason": "现有覆盖未验证恢复后的文件状态。",
                "coverage_gap": "缺少恢复后文件可读性和完整性检查。",
                "evidence_refs": evidence,
            }
        ],
        "review_notes": [{"content": "执行前需要确认文件完整性判定依据。", "evidence_refs": evidence}],
    }
    module_outputs = [{"module_analyses": [module_analysis]}]

    synthesis_input = regression._regression_synthesis_input(module_outputs, inputs, catalogs)
    compact_analysis = synthesis_input["module_analyses"][0]
    assert compact_analysis["existing_cases"] == [{"case_number": record["case_number"], "priority": "high"}]
    assert "reason" not in compact_analysis["existing_cases"][0]
    assert compact_analysis["new_target_count"] == 1

    raw_global = _global_output(report["id"], synthesis_input)
    result = regression._validate_global_synthesis_output(raw_global, inputs, catalogs, module_outputs)

    assert [item["case_number"] for item in result["existing_case_recommendations"]] == [record["case_number"]]
    assert [item["title"] for item in result["new_case_targets"]] == ["恢复后文件完整性检查"]
    assert [item["content"] for item in result["review_notes"]] == ["执行前需要确认文件完整性判定依据。"]
    assert module["name"] in result["modules"]


def test_global_synthesis_normalizes_cross_module_target_from_main_evidence(prepared, monkeypatch):
    _, report = ready(prepared, monkeypatch)
    inputs, catalogs = _load_inputs(report)
    modules = [item for item in inputs["main"]["facts"]["modules"] if item["records"]]
    assert len(modules) >= 2

    module_analyses = []
    cross_module_refs = []
    for module in modules[:2]:
        evidence = [{"report_id": report["id"], "evidence_ref": module["records"][0]["ref"]}]
        cross_module_refs.extend(evidence)
        module_analyses.append(
            {
                "module": module["name"],
                "summary": "该模块存在需要纳入回归判断的报告事实。",
                "findings": [{"content": "报告记录了需要复核的事实。", "evidence_refs": evidence}],
                "existing_case_recommendations": [],
                "new_case_targets": [],
                "review_notes": [],
            }
        )
    module_outputs = [{"module_analyses": module_analyses}]
    synthesis_input = regression._regression_synthesis_input(module_outputs, inputs, catalogs)

    raw_global = _global_output(report["id"], synthesis_input)
    raw_global["new_case_targets"] = [
        {
            "module": "帧率验证 + 多摄同步性 + 多摄画质一致性",
            "title": "多摄场景跨模块一致性验证",
            "test_item": "帧率、同步性与画质一致性",
            "priority": "high",
            "reason": "多个模块的报告证据共同表明需要验证联动场景。",
            "coverage_gap": "现有模块级目标未覆盖跨模块同时运行时的一致性。",
            "evidence_refs": cross_module_refs,
        }
    ]
    result = regression._validate_global_synthesis_output(raw_global, inputs, catalogs, module_outputs)

    assert len(result["new_case_targets"]) == 1
    assert result["new_case_targets"][0]["module"] == "跨模块"
    assert "帧率验证 + 多摄同步性 + 多摄画质一致性" not in result["modules"]

    invalid_global = _global_output(report["id"], synthesis_input)
    invalid_global["new_case_targets"] = [
        {
            **raw_global["new_case_targets"][0],
            "evidence_refs": cross_module_refs[:1],
        }
    ]
    with pytest.raises(ValueError, match="新增目标声明的模块与证据所属模块不一致"):
        regression._validate_global_synthesis_output(invalid_global, inputs, catalogs, module_outputs)


def test_global_module_schemas_accept_more_than_thirty_report_modules():
    evidence = {"report_id": 1, "evidence_ref": "module-record"}
    global_explanation = {"content": "根据主报告证据形成回归判断。", "evidence_refs": [evidence]}
    global_modules = [
        {
            "module": f"模块 {index}",
            "priority": "high",
            "reason": "主报告证据支持纳入回归范围。",
            "evidence_refs": [evidence],
        }
        for index in range(31)
    ]
    merged_modules = [
        {
            "module": f"模块 {index}",
            "priority": "high",
            "reason": "主报告证据支持纳入回归范围。",
            "evidence_refs": [evidence],
        }
        for index in range(31)
    ]

    synthesis = regression.RegressionGlobalSynthesisOutput.model_validate(
        {
            "analysis_sections": {
                "regression_necessity": global_explanation,
                "impact_analysis": global_explanation,
                "execution_strategy": global_explanation,
                "execution_readiness": global_explanation,
            },
            "key_changes": None,
            "summary": "根据主报告形成回归策略。",
            "modules": global_modules,
            "existing_case_recommendations": [],
            "new_case_targets": [],
            "review_notes": [],
        }
    )
    merged = regression.RegressionGlobalMergedOutput.model_validate(
        {
            "analysis_sections": {
                "regression_necessity": global_explanation,
                "impact_analysis": global_explanation,
                "execution_strategy": global_explanation,
                "execution_readiness": global_explanation,
            },
            "key_changes": None,
            "summary": "根据主报告形成回归策略。",
            "modules": merged_modules,
            "existing_case_recommendations": [],
            "new_case_targets": [],
            "review_notes": [],
        }
    )

    legacy = regression.RegressionGlobalOutput.model_validate(
        {
            "analysis_sections": {
                "regression_necessity": global_explanation,
                "impact_analysis": global_explanation,
                "execution_strategy": global_explanation,
                "execution_readiness": global_explanation,
            },
            "key_changes": None,
            "summary": "根据主报告形成回归策略。",
            "modules": merged_modules,
            "existing_case_recommendations": [],
            "new_case_targets": [],
            "review_notes": [],
        }
    )

    assert len(synthesis.modules) == 31
    assert len(merged.modules) == 31
    assert len(legacy.modules) == 31


def test_request_options_stream_g05_and_keep_output_budget():
    config = regression._regression_batch_config()
    assert config.modules_per_batch == 2
    assert config.records_per_batch == 20
    assert regression._regression_request_options("siliconflow", "Qwen/Qwen3.8-27B", config) == {
        "stream": True,
        "max_output_tokens": config.output_reserve_tokens,
    }
    assert regression._regression_request_options("deepseek", "deepseek-chat", config) == {
        "stream": True,
        "max_output_tokens": config.output_reserve_tokens,
    }
    detail_config = regression._regression_detail_batch_config("siliconflow", "deepseek-ai/DeepSeek-V4.1-Flash", config)
    assert detail_config.output_reserve_tokens == 40960
    assert regression._regression_detail_batch_size("siliconflow", "deepseek-ai/DeepSeek-V4.1-Flash") == 64
    assert regression._regression_request_options(
        "siliconflow",
        "deepseek-ai/DeepSeek-V4.1-Flash",
        detail_config,
        stage="intelligent_regression_detail",
    ) == {
        "stream": True,
        "max_output_tokens": 40960,
        "thinking_budget": 2048,
    }
    assert regression._regression_detail_batch_size("deepseek", "deepseek-chat") == 8


def test_detail_batch_layout_can_be_restored_from_checkpoint_plan(prepared, monkeypatch):
    _, report = ready(prepared, monkeypatch)
    inputs, catalogs = _load_inputs(report)
    output = _global_output(report["id"], {"modules": inputs["main"]["facts"]["modules"]}, include_target=True)
    first_module = next(module for module in inputs["main"]["facts"]["modules"] if module["records"])
    first_record = first_module["records"][0]
    first = {
        **output["new_case_targets"][0],
        "module": first_module["name"],
        "evidence_refs": [{"report_id": report["id"], "evidence_ref": first_record["ref"]}],
    }
    output["new_case_targets"] = [
        first,
        {
            **first,
            "title": "录像异常恢复后的重复启动检查",
            "test_item": "恢复后重复启动",
            "reason": "需要确认恢复后再次启动不会引入新的异常。",
            "coverage_gap": "缺少恢复完成后再次启动的独立验证。",
        },
    ]
    config = regression._regression_batch_config()

    initial_units = regression._build_regression_detail_units(output, inputs, catalogs, config)
    assert len(initial_units) == 1
    saved_batches = [[initial_units[0]["target_ids"][0]], [initial_units[0]["target_ids"][1]]]

    resumed_units = regression._build_regression_detail_units(
        output, inputs, catalogs, config, target_batches=saved_batches
    )

    assert [unit["target_ids"] for unit in resumed_units] == saved_batches
    assert "case_index" not in resumed_units[0]["payload"]["modules"][0]
    assert len(resumed_units[0]["payload"]["modules"][0]["related_records"]) == 1


def test_main_requires_successful_report_analysis(prepared, monkeypatch):
    client, _, _, _, report = prepared
    enable_ai(client, monkeypatch)
    response = client.post(endpoint(report), json={"report_ids": []})
    assert response.status_code == 409, response.text


def test_mock_pipeline_returns_four_sections_without_local_success_mode(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    response = client.post(endpoint(report), json={"report_ids": []})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["schema_version"] == 2
    assert data["generation_status"] == "complete_ai"
    assert set(data["analysis_sections"]) == {
        "regression_necessity",
        "impact_analysis",
        "execution_strategy",
        "execution_readiness",
    }
    assert "generation_mode" not in data
    assert "ai_enhancement_status" not in data
    assert data["candidate_count"] == len(data["candidates"])
    assert data["key_changes"] is None
    assert data["summary"]
    assert set(data["report_fingerprints"]) == {str(report["id"])}
    assert client.get(f"/api/fact-reports/{report['id']}").json()["snapshot"] == report["snapshot"]
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


def test_ai_configuration_is_required_and_no_local_fallback_is_published(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    monkeypatch.setattr(regression, "get_selected_snapshot", lambda _connection: None)
    monkeypatch.setattr(
        regression,
        "get_provider_adapter",
        lambda _provider: pytest.fail("未配置 AI 时不允许退回本地生成"),
    )
    response = client.post(endpoint(report), json={"report_ids": []})
    assert response.status_code == 409
    assert "必须调用 AI" in response.json()["detail"]
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


def test_one_click_reanalyzes_frozen_facts_and_generates_structured_case_in_second_ai_stage(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")
    inputs, _ = _load_inputs(report)
    calls = []

    class Adapter:
        request_logs = []

        def generate_json(self, **kwargs):
            calls.append(kwargs)
            payload = json.loads(kwargs["evidence_json"])
            if kwargs["stage"] == "intelligent_regression_detail":
                return _detail_output(payload)
            if kwargs["stage"] == "intelligent_regression_module":
                return _module_output(payload, report["id"])
            if "module_analyses" in payload:
                return _global_output(report["id"], payload, include_target=True)
            assert "main_overall_analysis" in payload
            assert payload["modules"]
            assert "case_details" in payload["modules"][0]["records"][0]
            return _global_output(report["id"], payload, include_target=True)

    monkeypatch.setattr(regression, "get_provider_adapter", lambda _provider: Adapter())
    response = client.post(endpoint(report), json={"report_ids": []})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["generation_status"] == "complete_ai"
    assert data["candidate_count"] == 1
    candidate = data["candidates"][0]
    assert candidate["title"] == "录像异常恢复后的文件完整性"
    assert candidate["preconditions"] and candidate["input"] and candidate["steps"]
    assert candidate["expected_result"]
    assert candidate["completion_status"] == "ready"
    assert candidate["sources"]
    assert all(call["stage"].startswith("intelligent_regression") for call in calls)
    assert any("不得只归纳" in call["system_prompt"] or "重新分析" in call["system_prompt"] for call in calls)
    assert not any("不是重新分析整份报告" in call["system_prompt"] for call in calls)
    assert len(calls) >= 2
    assert data["report_fingerprints"][str(report["id"])] == inputs["main"]["fact_fingerprint"]


def test_detail_generation_uses_one_large_batch_and_only_one_controlled_fallback_split(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")
    inputs, _ = _load_inputs(report)
    detail_batch_sizes = []
    detail_request_options = []
    detail_config = regression._regression_detail_batch_config
    request_options = regression._regression_request_options
    monkeypatch.setattr(regression, "_regression_detail_batch_size", lambda _provider, _model: 64)
    monkeypatch.setattr(
        regression,
        "_regression_request_options",
        lambda provider, model, config, *, stage=None: request_options(
            "siliconflow", "deepseek-ai/DeepSeek-V4.1-Flash", config, stage=stage
        ),
    )
    monkeypatch.setattr(
        regression,
        "_regression_detail_batch_config",
        lambda provider, model, config: detail_config("siliconflow", "deepseek-ai/DeepSeek-V4.1-Flash", config),
    )

    class Adapter:
        request_logs = []

        def generate_json(self, **kwargs):
            payload = json.loads(kwargs["evidence_json"])
            stage = kwargs["stage"]
            if stage == "intelligent_regression_module":
                return _module_output(payload, report["id"])
            if stage == "intelligent_regression_global":
                output = _global_output(report["id"], payload, include_target=True)
                first = output["new_case_targets"][0]
                first_module = next(
                    module for module in inputs["main"]["facts"]["modules"] if module["name"] == first["module"]
                )
                first["evidence_refs"] = [
                    {"report_id": report["id"], "evidence_ref": record["ref"]} for record in first_module["records"][:4]
                ]
                output["new_case_targets"] = [
                    {
                        **first,
                        "title": f"录像异常恢复后的第 {index + 1} 项完整性检查",
                        "test_item": f"恢复完整性检查 {index + 1}",
                    }
                    for index in range(64)
                ]
                return output
            if stage == "intelligent_regression_detail":
                detail_batch_sizes.append(len(payload["targets"]))
                detail_request_options.append(
                    {"max_output_tokens": kwargs["max_output_tokens"], "thinking_budget": kwargs["thinking_budget"]}
                )
                assert all("case_index" not in module for module in payload["modules"])
                if len(payload["targets"]) > 32:
                    raise SiliconFlowError(
                        ModelErrorKind.OUTPUT_TRUNCATED,
                        "模型输出被截断",
                        False,
                        stage=stage,
                        finish_reason="length",
                        response_chars=18532,
                    )
                return _detail_output(payload)
            raise AssertionError(f"unexpected stage: {stage}")

    monkeypatch.setattr(regression, "get_provider_adapter", lambda _provider: Adapter())
    response = client.post(endpoint(report), json={"report_ids": []})

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["generation_status"] == "complete_ai"
    assert data["candidate_count"] == 64
    assert detail_batch_sizes == [64, 32, 32]
    assert detail_request_options == [{"max_output_tokens": 40960, "thinking_budget": 2048}] * 3


def test_invalid_model_evidence_fails_without_publishing_a_result(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")

    class Adapter:
        request_logs = []

        def generate_json(self, **kwargs):
            payload = json.loads(kwargs["evidence_json"])
            if kwargs["stage"] == "intelligent_regression_module":
                return _module_output(payload, report["id"])
            return _global_output(report["id"], payload, invalid_evidence=True)

    monkeypatch.setattr(regression, "get_provider_adapter", lambda _provider: Adapter())
    response = client.post(endpoint(report), json={"report_ids": []})
    assert response.status_code == 422, response.text
    assert "证据引用不存在" in response.json()["detail"]
    current = client.get(endpoint(report) + "/current")
    assert current.status_code == 200
    assert current.json()["result"] is None
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


def test_network_failure_does_not_publish_or_replace_previous_valid_result(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    first = client.post(endpoint(report), json={"report_ids": []})
    assert first.status_code == 200, first.text
    previous = first.json()
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")
    calls = []

    class FailedAdapter:
        request_logs = []

        def generate_json(self, **kwargs):
            calls.append(kwargs)
            raise SiliconFlowError(
                ModelErrorKind.NETWORK,
                "模型响应传输中断",
                False,
                stage=kwargs["stage"],
                diagnostic="RemoteDisconnected",
                elapsed_ms=240300,
            )

    monkeypatch.setattr(regression, "get_provider_adapter", lambda _provider: FailedAdapter())
    failed = client.post(endpoint(report) + "?force=true", json={"report_ids": []})
    assert failed.status_code == 422
    assert "可能产生额外模型调用及费用" in failed.json()["detail"]
    assert "上一份有效建议保持不变" in failed.json()["detail"]
    assert len(calls) == 1
    current = client.get(endpoint(report) + "/current")
    assert current.json()["result"]["invocation_id"] == previous["invocation_id"]
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None


def test_module_analysis_coverage_mismatch_retries_as_single_module_requests():
    modules = [
        {"name": "录像异常恢复", "ref": "module:video", "records": []},
        {"name": "蓝牙连接稳定性", "ref": "module:bluetooth", "records": []},
    ]
    unit = {
        "module_names": [module["name"] for module in modules],
        "payload": {"modules": modules, "product_profile": None},
    }
    inputs = {
        "main": {
            "report_id": 77,
            "facts": {"modules": modules},
        }
    }
    catalogs = {77: {"module:video": "录像异常恢复", "module:bluetooth": "蓝牙连接稳定性"}}
    calls = []

    def analysis(module):
        return {
            "module": module["name"],
            "summary": f"{module['name']}已分析",
            "findings": [
                {
                    "content": f"{module['name']}证据分析",
                    "evidence_refs": [{"report_id": 77, "evidence_ref": module["ref"]}],
                }
            ],
            "existing_case_recommendations": [],
            "new_case_targets": [],
            "review_notes": [],
        }

    def request_json(stage, prompt, payload):
        calls.append((stage, prompt, payload))
        if len(calls) == 1:
            # Simulate a model that omitted the second module from a two-module batch.
            return {"module_analyses": [analysis(modules[0])]}
        assert len(payload["modules"]) == 1
        assert payload["modules"][0]["name"] in prompt
        return {"module_analyses": [analysis(payload["modules"][0])]}

    with pytest.raises(regression.ModuleAnalysisCoverageError, match="缺失=.*蓝牙连接稳定性"):
        regression._validate_module_analysis({"module_analyses": [analysis(modules[0])]}, unit, inputs, catalogs)

    result = regression._request_module_analysis(unit, inputs, catalogs, request_json)

    assert [item["module"] for item in result["module_analyses"]] == [
        "录像异常恢复",
        "蓝牙连接稳定性",
    ]
    assert len(calls) == 3
    assert all(call[0] == "intelligent_regression_module" for call in calls)


def test_auxiliary_report_without_ai_can_be_used_for_version_comparison(prepared, monkeypatch):
    client, project_id, _, _, report = prepared
    _, other_version, other_group = _create_group(client, project_id=project_id, version="EVT-0")
    _, batch = _batch(client, other_version, other_group, "passed")
    auxiliary = _report(client, other_group, automation_execution_id=None, manual_batch_ids=[batch]).json()
    assert auxiliary["analysis"]["status"] == "not_enabled"
    client, report = ready(prepared, monkeypatch)
    response = client.post(endpoint(report), json={"report_ids": [auxiliary["id"]]})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["auxiliary_report_ids"] == [auxiliary["id"]]
    assert result["key_changes"] is not None
    cited_ids = {item["report_id"] for item in result["key_changes"]["evidence_refs"]}
    assert report["id"] in cited_ids and auxiliary["id"] in cited_ids


def test_legacy_local_payload_is_read_but_marked_incomplete(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    response = client.post(endpoint(report), json={"report_ids": []})
    assert response.status_code == 200, response.text
    legacy = response.json()
    legacy["schema_version"] = 1
    legacy.pop("analysis_sections", None)
    legacy.pop("generation_status", None)
    legacy["generation_mode"] = "local"
    legacy["ai_enhancement_status"] = "not_requested"
    parsed = regression.RegressionResult.model_validate(legacy)
    assert parsed.generation_status == "legacy_incomplete"
    assert parsed.schema_version == 1


def test_same_input_guard_only_applies_to_complete_ai_result(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    first = client.post(endpoint(report), json={"report_ids": []})
    assert first.status_code == 200, first.text
    info = client.post(endpoint(report) + "/repeat-info", json={"report_ids": []})
    assert info.status_code == 200, info.text
    assert info.json()["same_input"] is True
    legacy = first.json()
    legacy["schema_version"] = 1
    legacy.pop("analysis_sections", None)
    legacy.pop("generation_status", None)
    legacy["generation_mode"] = "local"
    row = {
        "input_fingerprint": legacy["input_fingerprint"],
        "config_fingerprint": legacy["config_fingerprint"],
        "prompt_version": legacy["prompt_version"],
        "is_mock": int(legacy["is_mock"]),
        "payload": json.dumps(legacy, ensure_ascii=False),
    }
    assert not regression._same_input(
        row,
        legacy["input_fingerprint"],
        legacy["config_fingerprint"],
        True,
    )


def test_resume_reuses_completed_module_analysis_checkpoint(prepared, monkeypatch):
    client, report = ready(prepared, monkeypatch)
    monkeypatch.setenv("AI_DIAGNOSIS_MODE", "deepseek")
    monkeypatch.setenv("AI_BATCH_MODULES_PER_BATCH", "1")
    monkeypatch.setenv("AI_BATCH_RECORDS_PER_BATCH", "1")
    inputs, catalogs = _load_inputs(report)
    units = regression._regression_evidence_units(inputs, catalogs, regression._regression_batch_config())
    assert len(units) >= 2

    fail_once = True
    module_calls = 0
    global_calls = 0

    class Adapter:
        request_logs = []

        def generate_json(self, **kwargs):
            nonlocal fail_once, module_calls, global_calls
            payload = json.loads(kwargs["evidence_json"])
            if kwargs["stage"] == "intelligent_regression_module":
                module_calls += 1
                if fail_once and module_calls == 2:
                    fail_once = False
                    raise SiliconFlowError(
                        ModelErrorKind.NETWORK,
                        "模型响应传输中断",
                        False,
                        stage=kwargs["stage"],
                        diagnostic="RemoteDisconnected",
                    )
                return _module_output(payload, report["id"])
            if kwargs["stage"] == "intelligent_regression_global":
                global_calls += 1
                return _global_output(report["id"], payload)
            raise AssertionError(f"意外 AI 阶段：{kwargs['stage']}")

    adapter = Adapter()
    monkeypatch.setattr(regression, "get_provider_adapter", lambda _provider: adapter)
    failed = client.post(endpoint(report), json={"report_ids": []})
    assert failed.status_code == 422, failed.text
    info = client.post(endpoint(report) + "/repeat-info", json={"report_ids": []})
    assert info.status_code == 200, info.text
    assert info.json()["resume_available"] is True
    assert info.json()["completed_batches"] == 1
    calls_before_resume = module_calls

    resumed = client.post(
        endpoint(report),
        json={"report_ids": [], "resume": True},
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["generation_status"] == "complete_ai"
    assert module_calls == calls_before_resume + len(units) - 1
    assert global_calls == 1
    assert client.get("/api/settings/ai/active-invocation").json()["active"] is None
