"""T15: AI-first regression analysis from immutable final-report snapshots."""

import hashlib
import json
import re
import sqlite3
import time
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, model_validator

from app.ai_batching import batch_config, preflight_budget, semantic_batches, split_batch
from app.ai_checkpoint_resume import completed_units, resume_source, save_plan, save_unit
from app.ai_config import get_selected_snapshot, save_request_logs
from app.ai_invocation import (
    AiInvocationCancelled,
    begin_invocation,
    finish_invocation_in_transaction,
    get_active_invocation,
    request_invocation_cancel,
)
from app.database import open_database
from app.fact_report_models import RegressionAuxiliarySelection
from app.fact_reports import _historical_candidates, _valid_report_snapshot
from app.report_analysis import latest_analysis
from app.report_analysis_inputs import analysis_input
from app.settings import configured_api_key, current_settings, get_provider_adapter
from app.siliconflow import ModelErrorKind, SiliconFlowError

router = APIRouter(tags=["intelligent regression"])
REPORT_ROUTE = "/api/fact-reports/{report_id}/intelligent-regression"
PROMPT_VERSION = "intelligent-regression-v11-module-coverage-recovery"
GLOBAL_SYNTHESIS_VERSION = "intelligent-regression-global-v4-dynamic-module-count"
DETAIL_PROMPT_VERSION = "intelligent-regression-detail-v3-budgeted-single-pass"
DETAIL_BATCH_LAYOUT_VERSION = "detail-64-targets-output-40k-v1"
DETAIL_TARGETS_PER_BATCH = 64
DETAIL_FALLBACK_TARGETS_PER_BATCH = 32
DETAIL_OUTPUT_RESERVE_TOKENS = 40960
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10000)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
GlobalText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
DetailShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
DetailText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
DetailSteps = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1600)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class EvidenceRef(StrictModel):
    report_id: int = Field(gt=0)
    evidence_ref: ShortText


class Explanation(StrictModel):
    content: Text
    evidence_refs: list[EvidenceRef] = Field(min_length=1, max_length=30)


class Candidate(StrictModel):
    title: ShortText
    case_type: Literal["manual", "automation"]
    test_type: Literal["回归测试"] = "回归测试"
    module: ShortText
    priority: Literal["high", "medium", "low"]
    test_item: ShortText
    reason: ShortText
    preconditions: Text
    input: Text
    steps: Text
    expected_result: Text
    sources: list[EvidenceRef] = Field(min_length=1, max_length=20)
    completion_status: Literal["ready", "needs_details"] = "ready"


class RegressionExistingCaseDraft(StrictModel):
    module: ShortText
    case_number: ShortText
    priority: Literal["high", "medium", "low"]
    reason: ShortText
    evidence_refs: list[EvidenceRef] = Field(min_length=1, max_length=10)


class RegressionNewCaseTarget(StrictModel):
    module: ShortText
    title: ShortText
    test_item: ShortText
    priority: Literal["high", "medium", "low"]
    reason: ShortText
    coverage_gap: ShortText
    evidence_refs: list[EvidenceRef] = Field(min_length=1, max_length=20)


class RegressionModuleAnalysis(StrictModel):
    module: ShortText
    summary: ShortText
    findings: list[Explanation] = Field(max_length=20)
    existing_case_recommendations: list[RegressionExistingCaseDraft] = Field(max_length=100)
    new_case_targets: list[RegressionNewCaseTarget] = Field(max_length=50)
    review_notes: list[Explanation] = Field(max_length=20)


class RegressionModuleAnalysisOutput(StrictModel):
    module_analyses: list[RegressionModuleAnalysis] = Field(min_length=1, max_length=30)


class RegressionModuleScope(StrictModel):
    module: ShortText
    priority: Literal["high", "medium", "low"]
    reason: ShortText
    evidence_refs: list[EvidenceRef] = Field(min_length=1, max_length=20)


class RegressionAnalysisSections(StrictModel):
    regression_necessity: Explanation
    impact_analysis: Explanation
    execution_strategy: Explanation
    execution_readiness: Explanation


class RegressionGlobalOutput(StrictModel):
    analysis_sections: RegressionAnalysisSections
    key_changes: Explanation | None
    summary: ShortText
    modules: list[RegressionModuleScope]
    existing_case_recommendations: list[RegressionExistingCaseDraft] = Field(max_length=100)
    new_case_targets: list[RegressionNewCaseTarget] = Field(max_length=100)
    review_notes: list[Explanation] = Field(max_length=30)


class GlobalExplanation(StrictModel):
    content: GlobalText
    evidence_refs: list[EvidenceRef] = Field(min_length=1, max_length=2)


class GlobalAnalysisSections(StrictModel):
    regression_necessity: GlobalExplanation
    impact_analysis: GlobalExplanation
    execution_strategy: GlobalExplanation
    execution_readiness: GlobalExplanation


class GlobalModuleScope(StrictModel):
    module: ShortText
    priority: Literal["high", "medium", "low"]
    reason: GlobalText
    evidence_refs: list[EvidenceRef] = Field(min_length=1, max_length=2)


class GlobalCaseTarget(StrictModel):
    module: ShortText
    title: GlobalText
    test_item: GlobalText
    priority: Literal["high", "medium", "low"]
    reason: GlobalText
    coverage_gap: GlobalText
    evidence_refs: list[EvidenceRef] = Field(min_length=1, max_length=4)


class RegressionGlobalSynthesisOutput(StrictModel):
    analysis_sections: GlobalAnalysisSections
    key_changes: GlobalExplanation | None
    summary: GlobalText
    modules: list[GlobalModuleScope]
    existing_case_recommendations: list[RegressionExistingCaseDraft] = Field(default_factory=list, max_length=0)
    new_case_targets: list[GlobalCaseTarget] = Field(default_factory=list, max_length=3)
    review_notes: list[GlobalExplanation] = Field(default_factory=list, max_length=2)


class RegressionGlobalMergedOutput(StrictModel):
    analysis_sections: RegressionAnalysisSections
    key_changes: Explanation | None
    summary: ShortText
    modules: list[RegressionModuleScope]
    existing_case_recommendations: list[RegressionExistingCaseDraft] = Field(max_length=1000)
    new_case_targets: list[RegressionNewCaseTarget] = Field(max_length=1000)
    review_notes: list[Explanation] = Field(max_length=1000)


class RegressionDetailCandidate(Candidate):
    target_id: DetailShortText
    title: DetailShortText
    module: DetailShortText
    test_item: DetailShortText
    reason: DetailText
    preconditions: DetailText
    input: DetailText
    steps: DetailSteps
    expected_result: DetailText
    sources: list[EvidenceRef] = Field(min_length=1, max_length=20)


class RegressionDeferredTarget(StrictModel):
    target_id: DetailShortText
    reason: DetailText
    evidence_refs: list[EvidenceRef] = Field(min_length=1, max_length=20)


class RegressionDetailOutput(StrictModel):
    candidates: list[RegressionDetailCandidate] = Field(max_length=100)
    deferred_targets: list[RegressionDeferredTarget] = Field(max_length=100)


class SourceFinding(EvidenceRef):
    product_version: str
    finding: str


class RegressionCandidate(Candidate):
    id: int
    source_findings: list[SourceFinding]


class RegressionExistingCase(BaseModel):
    id: int
    case_number: str
    title: str
    module: str
    source: str
    status: str
    priority: Literal["high", "medium", "low"]
    reason: str
    sources: list[EvidenceRef]
    source_findings: list[SourceFinding]


class RegressionReviewNote(BaseModel):
    content: str
    source_findings: list[SourceFinding]


class RegressionDeferredTargetResult(BaseModel):
    module: str
    title: str
    reason: str
    source_findings: list[SourceFinding]


class RegressionResult(BaseModel):
    schema_version: int = 2
    generation_status: Literal["complete_ai", "legacy_incomplete"] = "complete_ai"
    project_id: int
    main_report_id: int
    main_product_version_id: int
    auxiliary_report_ids: list[int]
    input_fingerprint: str
    ai_context_fingerprint: str
    report_fingerprints: dict[int, str]
    invocation_id: str
    config_fingerprint: str
    is_mock: bool
    generated_at: str
    prompt_version: str
    invocation_status: Literal["completed"] = "completed"
    analysis_sections: RegressionAnalysisSections | None = None
    key_changes: Explanation | None = None
    review_notes: list[RegressionReviewNote] = Field(default_factory=list)
    deferred_targets: list[RegressionDeferredTargetResult] = Field(default_factory=list)
    summary: str
    modules: list[str]
    existing_case_recommendations: list[RegressionExistingCase] = Field(default_factory=list)
    candidate_count: int
    candidates: list[RegressionCandidate]
    # Hidden compatibility fields: old persisted payloads are read, but never
    # serialized as a successful local/optional-AI result in the new contract.
    overall_risk: Explanation | None = Field(default=None, exclude=True)
    regression_focus: Explanation | None = Field(default=None, exclude=True)
    generation_mode: Literal["local", "ai_enhanced"] | None = Field(default=None, exclude=True)
    ai_enhancement_status: Literal["not_requested", "completed", "failed", "cancelled"] | None = Field(
        default=None, exclude=True
    )
    ai_enhancement_message: str | None = Field(default=None, exclude=True)

    @model_validator(mode="before")
    @classmethod
    def mark_legacy_payload(cls, value):
        if not isinstance(value, dict):
            return value
        data = dict(value)
        sections = data.get("analysis_sections")
        valid_sections = isinstance(sections, dict) and all(
            key in sections
            for key in (
                "regression_necessity",
                "impact_analysis",
                "execution_strategy",
                "execution_readiness",
            )
        )
        if data.get("schema_version") != 2 or not valid_sections:
            data["schema_version"] = 1
            data["generation_status"] = "legacy_incomplete"
        else:
            data["generation_status"] = "complete_ai"
        return data


def _digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def _fact(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _module_source_catalog(source_catalog: dict, module_name: str) -> dict:
    """Keep only the frozen directory summary for the requested module."""
    groups = source_catalog.get("groups", []) if isinstance(source_catalog, dict) else []
    matching = [item for item in groups if item.get("module") == module_name]
    return {
        "defined_count": sum(item.get("defined_count", 0) for item in matching),
        "matching_report_number_count": sum(item.get("matching_report_number_count", 0) for item in matching),
        "groups": matching,
    }


def _report_context(report: dict) -> dict:
    facts = report["facts"]
    return {
        "report_id": report["report_id"],
        "product_version": report["product_version"],
        "generated_at": report.get("generated_at"),
        "test_group": report.get("test_group"),
        "stage_progress": facts.get("stage_progress"),
        "scope_overview": facts.get("scope_overview"),
        "pass_rate": facts.get("pass_rate"),
        "modules": [
            {"name": item["name"], "conclusion": item["conclusion"], "counts": item["counts"]}
            for item in facts.get("modules", [])
        ],
    }


def _load_report(connection, row, *, main: bool) -> tuple[dict, dict[str, str]]:
    report_id = row["id"]
    analysis = latest_analysis(connection, report_id)
    analysis_input_snapshot: dict = {}
    try:
        snapshot = json.loads(row["snapshot"])
        if not _valid_report_snapshot(snapshot):
            raise ValueError("invalid snapshot")
        facts, _ = analysis_input(snapshot)
        # Preserve each report's own statistics and context; never query live execution/case data.
        for field in ("pass_rate", "module_summary", "warnings"):
            facts[field] = snapshot.get(field, [] if field == "warnings" else None)

        if analysis.status == "completed" and analysis.run_id is not None:
            analysis_row = connection.execute(
                """SELECT input_snapshot FROM report_analysis_runs
                   WHERE id = ? AND report_id = ? AND status = 'completed'""",
                (analysis.run_id, report_id),
            ).fetchone()
            if analysis_row and analysis_row["input_snapshot"]:
                analysis_input_snapshot = json.loads(analysis_row["input_snapshot"])
            if main and not analysis_input_snapshot:
                raise HTTPException(409, "主报告 AI 总体分析缺少原始输入快照，请重新分析报告")
        elif main and analysis.status == "completed":
            # In-process/mock analyses used by deterministic tests have no durable run id.
            analysis_input_snapshot = {
                "product_profile": json.loads(row["product_profile"]) if row["product_profile"] else None,
                "version_ai_context": row["ai_context"] or "",
                "source_catalog": {},
            }

        if main and (analysis.status != "completed" or analysis.output is None):
            raise HTTPException(409, "主报告 AI 总体分析尚未成功完成")

        # The frozen analysis input must describe the same immutable report facts.
        for field in (
            "stage_progress",
            "scope_overview",
            "execution_context",
            "modules",
            "cross_module_issues",
            "historical_reports",
        ):
            if field in analysis_input_snapshot and analysis_input_snapshot[field] != facts.get(field):
                raise HTTPException(409, "报告 AI 总体分析输入与当前报告事实不一致，请重新分析报告")

        catalog = {
            "stage_progress": _fact(facts["stage_progress"]),
            "scope_overview": _fact(facts["scope_overview"]),
            "pass_rate": _fact(facts["pass_rate"]),
        }
        if facts["execution_context"]:
            catalog["execution_context"] = _fact(facts["execution_context"])
        # These references belong to the frozen AI analysis context, not the live project state.
        for reference in ("product_profile", "source_catalog", "version_ai_context"):
            if reference in analysis_input_snapshot:
                catalog[reference] = _fact(analysis_input_snapshot[reference])
        for module in facts["modules"]:
            catalog[module["ref"]] = _fact(
                {"name": module["name"], "conclusion": module["conclusion"], "counts": module["counts"]}
            )
            for record in module["records"]:
                catalog[record["ref"]] = (
                    f"{record['case_number']} · {record['title']} · {record['source']} · "
                    f"{record['status']}：{record['message']}"
                )
        for issue in facts["cross_module_issues"]:
            catalog[issue["ref"]] = _fact(issue)
        for historical in facts["historical_reports"]:
            catalog[historical["ref"]] = _fact(historical)
        # Keep the original test-case definition inside the immutable report facts
        # for deterministic local regression drafts. It is deliberately excluded
        # from the AI analysis input and from the optional model payload.
        for module_facts, module_snapshot in zip(facts["modules"], snapshot["modules"]):
            for record_facts, record_snapshot in zip(module_facts["records"], module_snapshot["records"]):
                record_facts["case_details"] = {
                    field: str(record_snapshot.get(field, "") or "")
                    for field in (
                        "priority",
                        "preconditions",
                        "input",
                        "steps",
                        "expected_result",
                        "test_type",
                        "test_item",
                        "case_type",
                    )
                }
        version = snapshot["basic_information"]["product_version"]
        if not isinstance(version, str) or not version.strip():
            raise ValueError("invalid version")
    except HTTPException:
        raise
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise HTTPException(422, f"报告 #{report_id} 缺少完整有效事实快照") from exc
    return {
        "report_id": report_id,
        "product_version": version,
        "generated_at": snapshot["basic_information"].get("generated_at"),
        "test_group": snapshot["basic_information"].get("test_group"),
        "fact_fingerprint": _digest(snapshot),
        "facts": facts,
        "overall_analysis": analysis.output.model_dump()
        if analysis.status == "completed" and analysis.output
        else None,
        "analysis_input_snapshot": analysis_input_snapshot,
    }, catalog


def load_inputs(connection, report_id: int, report_ids: list[int]) -> tuple[dict, dict]:
    row = connection.execute(
        """SELECT r.*, v.project_id, v.ai_context, p.product_profile
           FROM online_reports r JOIN product_versions v ON r.product_version_id = v.id
           JOIN projects p ON v.project_id = p.id WHERE r.id = ?""",
        (report_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "主报告不存在")
    main, catalog = _load_report(connection, row, main=True)
    main_analysis_context = main.pop("analysis_input_snapshot", {})
    catalogs = {report_id: catalog}
    excluded = {report_id, *(item["report_id"] for item in main["facts"]["historical_reports"])}
    if len(report_ids) != len(set(report_ids)) or any(i <= 0 or i in excluded for i in report_ids):
        raise HTTPException(422, "辅助报告编号无效、重复或已纳入主报告")
    options = {item["id"]: item for item in _historical_candidates(connection, row["test_group_id"])}
    auxiliary = []
    for item in report_ids:
        source = options.get(item)
        if source is None or source["product_version"] == main["product_version"]:
            raise HTTPException(422, f"辅助报告 #{item} 不存在、跨项目或与主报告同版本")
        data, refs = _load_report(connection, source, main=False)
        auxiliary_analysis_context = data.pop("analysis_input_snapshot", {})
        data["analysis_context"] = {
            "product_profile": auxiliary_analysis_context.get("product_profile"),
            "version_ai_context": auxiliary_analysis_context.get("version_ai_context") or "",
            "source_catalog": auxiliary_analysis_context.get("source_catalog") or {},
        }
        auxiliary.append(data)
        catalogs[item] = refs
    return {
        "project_id": row["project_id"],
        "main_product_version_id": row["product_version_id"],
        "main": main,
        "auxiliary": auxiliary,
        # Current project/version context is frozen at regression invocation start.
        "product_profile": json.loads(row["product_profile"]) if row["product_profile"] else None,
        "version_ai_context": row["ai_context"] or "",
        "report_analysis_context": {
            "product_profile": main_analysis_context.get("product_profile"),
            "version_ai_context": main_analysis_context.get("version_ai_context") or "",
            "source_catalog": main_analysis_context.get("source_catalog") or {},
        },
    }, catalogs


def _regression_batch_config():
    base = batch_config()
    return batch_config(
        overrides={
            "modules_per_batch": min(base.modules_per_batch, 2),
            "records_per_batch": min(base.records_per_batch, 20),
            "cases_per_batch": min(base.cases_per_batch, 20),
            "output_reserve_tokens": base.output_reserve_tokens,
            "call_limit": base.call_limit,
            "context_token_limit": base.context_token_limit,
        }
    )


def _regression_detail_batch_config(provider: str, model: str, config):
    if provider != "siliconflow" or model != "deepseek-ai/DeepSeek-V4.1-Flash":
        return config
    return batch_config(
        overrides={
            "modules_per_batch": config.modules_per_batch,
            "records_per_batch": config.records_per_batch,
            "cases_per_batch": config.cases_per_batch,
            "output_reserve_tokens": DETAIL_OUTPUT_RESERVE_TOKENS,
            "call_limit": config.call_limit,
            "context_token_limit": config.context_token_limit,
        }
    )


def _regression_detail_batch_size(provider: str, model: str) -> int:
    if provider == "siliconflow" and model == "deepseek-ai/DeepSeek-V4.1-Flash":
        return DETAIL_TARGETS_PER_BATCH
    return 8


def _regression_request_options(provider: str, model: str, config, *, stage: str | None = None) -> dict[str, object]:
    # Stream G05 JSON responses and bound DeepSeek V4.1 Flash reasoning for the
    # detail stage: it transforms already-reviewed targets into executable cases.
    options: dict[str, object] = {"stream": True, "max_output_tokens": config.output_reserve_tokens}
    if (
        provider == "siliconflow"
        and model == "deepseek-ai/DeepSeek-V4.1-Flash"
        and stage == "intelligent_regression_detail"
    ):
        options["thinking_budget"] = 2048
    return options


def _regression_plan_metadata(units: list[dict], inputs: dict) -> dict:
    batch_keys = [unit["key"] for unit in units]
    module_names = list(dict.fromkeys(name for unit in units for name in unit["module_names"]))
    return {
        "regression_batch_keys": batch_keys,
        "regression_plan_fingerprint": _digest({"batch_keys": batch_keys, "prompt_version": PROMPT_VERSION}),
        "regression_module_names": module_names,
        "regression_batch_count": len(batch_keys),
        "total_modules": len(module_names),
        "phase": "preparing",
    }


def _resume_plan_expectation(plan: dict) -> dict:
    # Dynamic detail units are known only after global analysis; the stable evidence-plan
    # fingerprint is enough to authorize reuse of the saved global and detail checkpoints.
    return {"regression_plan_fingerprint": plan["regression_plan_fingerprint"]}


class RegressionCheckpoints:
    """T08-compatible immutable module-batch checkpoints with explicit human resume."""

    def __init__(self, lease, resumed_from: str | None):
        self.lease = lease
        self.previous = completed_units(resumed_from)
        self.current: dict[str, dict] = {}

    def get(self, key: str) -> dict | None:
        return self.current.get(key) or self.previous.get(key)

    def save(self, key: str, index: int, output: dict) -> None:
        with open_database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self.lease.assert_can_commit(connection)
            save_unit(connection, self.lease.invocation_id, key, index, output)
            connection.commit()
        self.current[key] = output


def _update_regression_plan(invocation_id: str, updates: dict) -> None:
    with open_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT plan_json FROM ai_batch_runs WHERE invocation_id = ? AND status = 'running'",
            (invocation_id,),
        ).fetchone()
        if row is None:
            raise AiInvocationCancelled("智能回归任务已结束，不能更新检查点状态")
        plan = json.loads(row["plan_json"] or "{}")
        plan.update(updates)
        connection.execute(
            "UPDATE ai_batch_runs SET plan_json = ? WHERE invocation_id = ?",
            (json.dumps(plan, ensure_ascii=False), invocation_id),
        )
        connection.commit()


def _ai_record_payload(record: dict) -> dict:
    """Send the immutable case definition with its result; never query mutable live cases."""
    return {
        "ref": record["ref"],
        "case_number": record["case_number"],
        "title": record["title"],
        "test_item": record.get("test_item") or "",
        "source": record["source"],
        "status": record["status"],
        "message": record.get("message") or "",
        "executed_at": record.get("executed_at"),
        "result_consistency": record.get("result_consistency"),
        "case_details": record.get("case_details") or {},
    }


def _regression_global_context(inputs: dict) -> dict:
    main = inputs["main"]
    facts = main["facts"]
    auxiliary = []
    for report in inputs["auxiliary"]:
        auxiliary_facts = report["facts"]
        auxiliary.append(
            {
                "report": _report_context(report),
                "fact_context": {
                    "stage_progress": auxiliary_facts.get("stage_progress"),
                    "scope_overview": auxiliary_facts.get("scope_overview"),
                    "pass_rate": auxiliary_facts.get("pass_rate"),
                    "warnings": auxiliary_facts.get("warnings") or [],
                    "cross_module_issues": auxiliary_facts.get("cross_module_issues") or [],
                    "historical_reports": auxiliary_facts.get("historical_reports") or [],
                    "module_summary": auxiliary_facts.get("module_summary") or [],
                },
            }
        )
    return {
        "main_report": _report_context(main),
        "main_overall_analysis": main.get("overall_analysis") or {},
        "main_fact_context": {
            "stage_progress": facts.get("stage_progress"),
            "scope_overview": facts.get("scope_overview"),
            "pass_rate": facts.get("pass_rate"),
            "warnings": facts.get("warnings") or [],
            "cross_module_issues": facts.get("cross_module_issues") or [],
            "historical_reports": facts.get("historical_reports") or [],
            "module_summary": facts.get("module_summary") or [],
        },
        "auxiliary_reports": auxiliary,
        "product_profile": inputs.get("product_profile"),
        "version_ai_context": inputs.get("version_ai_context") or "",
    }


def _regression_evidence_units(inputs: dict, catalogs: dict[str, dict[str, str]], config) -> list[dict]:
    """Build complete semantic evidence units; dynamically split only when the model budget requires it."""
    main = inputs["main"]
    source_catalog = (inputs.get("report_analysis_context") or {}).get("source_catalog") or {}
    modules = [
        {
            "ref": module["ref"],
            "name": module["name"],
            "conclusion": module["conclusion"],
            "counts": module["counts"],
            "records": [_ai_record_payload(record) for record in module["records"]],
            "source_catalog": _module_source_catalog(source_catalog, module["name"]),
        }
        for module in main["facts"].get("modules", [])
    ]
    analysis_input = {
        "modules": modules,
        "stage_progress": main["facts"].get("stage_progress"),
        "scope_overview": main["facts"].get("scope_overview"),
        "execution_context": main["facts"].get("execution_context"),
        "product_profile": inputs.get("product_profile"),
        "version_ai_context": inputs.get("version_ai_context") or "",
        "historical_reports": main["facts"].get("historical_reports") or [],
        "cross_module_issues": main["facts"].get("cross_module_issues") or [],
    }
    base = _regression_global_context(inputs)
    batches = semantic_batches(analysis_input, config)
    expected_modules = {(module["name"], module["ref"]) for module in modules}
    expected_records = {(module["name"], record["ref"]) for module in modules for record in module["records"]}
    batched_modules = {(module["name"], module["ref"]) for batch in batches for module in batch["modules"]}
    batched_records = {
        (module["name"], record["ref"])
        for batch in batches
        for module in batch["modules"]
        for record in module["records"]
    }
    if batched_modules != expected_modules or batched_records != expected_records:
        raise ValueError("回归证据分组未完整覆盖主报告模块和用例记录，已停止生成以避免静默丢失证据")

    if len(batches) == 1:
        batch = batches[0]
        payload = {**base, "modules": batch["modules"]}
        prompt = _regression_global_prompt()
        try:
            preflight_budget(
                prompt + json.dumps(payload, ensure_ascii=False),
                config,
                stage="intelligent_regression_global",
            )
            return [
                {
                    "key": _digest({"phase": "global", "payload": payload, "prompt": PROMPT_VERSION})[:24],
                    "kind": "global",
                    "module_names": [item["name"] for item in batch["modules"]],
                    "payload": payload,
                }
            ]
        except SiliconFlowError as error:
            if error.kind != ModelErrorKind.INVALID_REQUEST:
                raise
            parts = split_batch(batch)
            if parts is None:
                raise

            batches = parts

    pending = list(batches)
    units: list[dict] = []
    while pending:
        batch = pending.pop(0)
        payload = {**base, "modules": batch["modules"]}
        prompt = _regression_module_prompt([item["name"] for item in batch["modules"]])
        try:
            preflight_budget(
                prompt + json.dumps(payload, ensure_ascii=False),
                config,
                stage="intelligent_regression_module",
            )
        except SiliconFlowError as error:
            if error.kind != ModelErrorKind.INVALID_REQUEST:
                raise
            parts = split_batch(batch)
            if parts is None:
                raise
            pending = [*parts, *pending]
            continue
        names = [item["name"] for item in batch["modules"]]
        units.append(
            {
                "key": _digest({"phase": "module", "payload": payload, "prompt": PROMPT_VERSION})[:24],
                "kind": "module",
                "module_names": names,
                "payload": payload,
            }
        )
    covered_modules = {(module["name"], module["ref"]) for unit in units for module in unit["payload"]["modules"]}
    covered_records = {
        (module["name"], record["ref"])
        for unit in units
        for module in unit["payload"]["modules"]
        for record in module["records"]
    }
    if covered_modules != expected_modules or covered_records != expected_records:
        raise ValueError("上下文预算拆分后未能保留全部报告证据，已停止生成以避免静默丢失")
    return units


def _regression_global_prompt() -> str:
    return (
        "你是资深智能硬件测试负责人，负责为下一轮测试制定专业、可执行的回归方案。"
        "本任务不是生成管理层最终测试报告：不得重新给出项目交付结论、阶段放行结论或管理决策；这些由最终测试报告负责。"
        "你必须重新分析输入中的冻结事实、测试结果、产品画像、版本上下文、原用例定义和报告 AI 总体分析。"
        "regression_recommendations、risks、test_directions 都只是证据线索，不是待照抄的任务清单；"
        "不得只归纳、去重或排序这些文字。"
        "请独立判断回归必要性和范围，分析失败/阻塞/不一致/历史退化及跨模块影响，判断现有用例能否覆盖，识别真实覆盖缺口并制定执行策略。"
        "先输出四段回归分析：regression_necessity 回答是否需要回归、范围和模块；"
        "impact_analysis 说明证据到影响链路与风险的推导；"
        "execution_strategy 说明复测已有用例、新增覆盖、人工/自动化方式、优先级、执行顺序和依赖；"
        "execution_readiness 说明设备/软件版本/环境/数据/配置/前置条件、可观察的验收边界及待确认事项。"
        "这四段是测试执行方案，不得写成管理层是否放行的结论。每段必须引用真实 evidence_refs。"
        "existing_case_recommendations 只引用报告中真实存在的原用例编号；说明复测原因和风险关联，"
        "不复制成新用例，不改写原用例。"
        "new_case_targets 只描述已有用例不能覆盖的独立回归缺口；不得把新功能测试、探索性测试或一般质量改进冒充回归。"
        "新增目标必须有主报告证据；具体完整步骤留给下一阶段生成。不能证明存在覆盖缺口时，不生成目标。"
        "module 只能使用输入中的真实模块名称；只有确实跨模块且引用至少两个模块证据时才使用“跨模块”。"
        "有辅助报告时，区分测试事实变化与产品功能变更；没有变更记录不得声称代码/设计发生变化。"
        "key_changes 必须同时引用主报告和至少一份辅助报告；未选择辅助报告时必须为 null。"
        "不得编造产品行为、数值阈值、版本变化、用例编号、执行结果或证据引用。"
        "证据不足时写入 review_notes，说明缺少什么及其影响。"
        "如果无需新增回归，允许 existing_case_recommendations 和 new_case_targets 为空，并明确说明判断依据。"
        "所有证据引用必须来自本次输入中实际出现的 evidence_ref，不得猜测或生成新引用。"
        "只返回符合以下 JSON Schema 的对象，不要输出 Markdown 或过程说明："
        + json.dumps(RegressionGlobalOutput.model_json_schema(), ensure_ascii=False)
    )


def _regression_module_prompt(module_names: list[str], *, recovery: bool = False) -> str:
    allowed_modules = json.dumps(module_names, ensure_ascii=False)
    recovery_instruction = (
        "这是一次单模块纠正请求。输入只有一个模块；只允许返回一条 module_analyses，"
        "module 必须逐字等于允许模块名称，不得返回空数组、其他模块或重复结果。"
        if recovery
        else "本批允许返回的模块名称只有以下列表；每个名称必须逐字匹配，并且每个模块恰好返回一条结果："
    )
    return (
        "你是资深智能硬件测试负责人。请对输入中每个模块的冻结测试事实和原用例定义做专业影响分析。"
        "必须重新检查所有提供的记录、状态、实际结果、case_details 和测试目录，不得只归纳报告 AI 建议。"
        + recovery_instruction
        + allowed_modules
        + "。不得遗漏、重复、改写模块名称，也不得输出列表以外的模块。"
        "判断哪些原用例值得复测，哪些现有覆盖无法满足而形成独立回归缺口。"
        "existing_case_recommendations 必须引用真实 case_number 和对应主报告 record ref。"
        "new_case_targets 只提出有证据支持且现有用例不能覆盖的具体缺口，不生成完整用例，不把已有用例复制为新用例。"
        "findings 和 review_notes 中的重要判断必须引用输入中真实证据。不得编造阈值、产品行为或测试结果。"
        "只返回符合以下 JSON Schema 的 JSON 对象："
        + json.dumps(RegressionModuleAnalysisOutput.model_json_schema(), ensure_ascii=False)
    )


def _regression_synthesis_prompt() -> str:
    return (
        "你是资深智能硬件测试负责人。请综合模块分析结论和报告级事实，形成精炼的全局回归策略。"
        "本阶段只负责四段全局策略、模块优先级和真正的跨模块问题；不得复述模块分析的详细内容。"
        "必须输出 regression_necessity、impact_analysis、execution_strategy、execution_readiness 四段；"
        "每段只写 1～2 句、控制在 200 字以内，并引用 1～2 条最关键证据。"
        "summary 控制在 200 字以内；每个模块 reason 控制在 120 字以内。"
        "模块级 existing_case_recommendations、new_case_targets 和 review_notes 已保存在检查点中，系统会直接合并；"
        "因此 existing_case_recommendations 必须返回空数组，禁止重新抄写模块级复测建议。"
        "new_case_targets 只允许提出真正跨越至少两个模块、且不能由已有模块目标覆盖的新缺口，最多 3 条；"
        "跨模块新增目标的 module 字段必须使用固定值“跨模块”，实际涉及的模块以 evidence_refs 对应的主报告证据为准；"
        "没有充分证据时返回空数组，禁止为了凑数而生成目标。"
        "review_notes 只保留全局或跨模块层面确实需要人工确认的事项，最多 2 条。"
        "modules 只列出需要纳入回归范围的模块；不得遗漏有证据支持的高风险模块。"
        "有辅助报告时 key_changes 必须同时引用主报告和辅助报告；无辅助报告时为 null。"
        "不得编造产品行为、阈值、变更、用例编号或证据。只返回符合以下 JSON Schema 的 JSON 对象："
        + json.dumps(RegressionGlobalSynthesisOutput.model_json_schema(), ensure_ascii=False)
    )


def _regression_detail_prompt() -> str:
    return (
        "你是资深智能硬件测试用例设计专家。根据输入中的全局回归策略、具体覆盖缺口、原用例定义和证据，"
        "把每个 target_id 转换为一条真正可执行、可判定的新增回归测试用例。"
        "每个 target_id 最多生成一条候选用例；若证据不足，则只生成一条 deferred_target，二者只能选择其一。"
        "若一个覆盖缺口实际包含多个彼此独立的场景，应在全局阶段拆成多个 target_id，本阶段不得扩写成多条用例。"
        "不得复测原用例后又把同一场景复制成新用例；不得编造产品能力、接口、数值阈值或未提供的测试数据。"
        "输出保持精炼但具体：前置条件、输入、步骤和预期结果必须可操作、可判定，不复述整段报告。步骤通常控制在 3～8 步。"
        "每条用例必须包含标题、人工/自动化执行方式（case_type）、模块、测试类型（系统固定为回归测试）、"
        "测试项、优先级、回归原因、前置条件、输入、步骤、可观察的预期结果和来源证据。"
        "test_type 不得改成执行方式。"
        "自动化仅在输入、步骤和结果都可稳定机器执行/断言时选择 automation；否则选择 manual。"
        "若现有证据和产品上下文不足以形成可判定用例，不要用“待补充”伪造完整用例；"
        "将该 target_id 放入 deferred_targets，说明缺少的信息及原因。"
        "每个 target_id 必须至少被一条候选或一条 deferred_target 处理，不能静默遗漏。"
        "候选 sources 必须包含该 target 的至少一条原始 evidence_ref；"
        "所有引用必须来自本次输入中实际出现的 evidence_ref。"
        "只返回符合以下 JSON Schema 的 JSON 对象："
        + json.dumps(RegressionDetailOutput.model_json_schema(), ensure_ascii=False)
    )


def _validate_refs(
    refs: list[EvidenceRef], catalogs: dict[int, dict[str, str]], *, require_main: bool, main_id: int
) -> None:
    seen = set()
    has_main = False
    for ref in refs:
        key = (ref.report_id, ref.evidence_ref)
        if key in seen:
            raise ValueError("同一条分析或建议重复引用相同证据")
        seen.add(key)
        if ref.evidence_ref not in catalogs.get(ref.report_id, {}):
            raise ValueError(f"证据引用不存在或不在本次输入范围：报告 #{ref.report_id} / {ref.evidence_ref}")
        has_main = has_main or ref.report_id == main_id
    if require_main and not has_main:
        raise ValueError("本次回归分析必须至少引用一条主报告证据")


def _validate_existing_drafts(items: list[RegressionExistingCaseDraft], inputs: dict, catalogs: dict) -> list[dict]:
    main = inputs["main"]
    main_id = main["report_id"]
    records = {
        (module["name"], record["case_number"]): record
        for module in main["facts"].get("modules", [])
        for record in module.get("records", [])
    }
    merged: dict[tuple[str, str], dict] = {}
    for item in items:
        record = records.get((item.module, item.case_number))
        if record is None:
            raise ValueError(f"复测建议引用了主报告不存在的用例：{item.module} / {item.case_number}")
        _validate_refs(item.evidence_refs, catalogs, require_main=True, main_id=main_id)
        if not any(ref.report_id == main_id and ref.evidence_ref == record["ref"] for ref in item.evidence_refs):
            raise ValueError(f"既有用例 {item.case_number} 必须引用其自身的主报告执行记录")
        key = (item.module, item.case_number)
        current = merged.get(key)
        if current is None:
            merged[key] = item.model_dump()
        else:
            current["reason"] = "；".join(dict.fromkeys([current["reason"], item.reason]))[:4000]
            current["evidence_refs"] = list(
                {
                    (ref["report_id"], ref["evidence_ref"]): ref
                    for ref in [*current["evidence_refs"], *item.model_dump()["evidence_refs"]]
                }.values()
            )
            if item.priority == "high":
                current["priority"] = "high"
            elif item.priority == "medium" and current["priority"] == "low":
                current["priority"] = "medium"
    return list(merged.values())


def _validate_global_output(raw: dict, inputs: dict, catalogs: dict) -> dict:
    output = RegressionGlobalMergedOutput.model_validate(raw)
    main = inputs["main"]
    main_id = main["report_id"]
    main_modules = {item["name"]: item for item in main["facts"].get("modules", [])}
    for section in (
        output.analysis_sections.regression_necessity,
        output.analysis_sections.impact_analysis,
        output.analysis_sections.execution_strategy,
        output.analysis_sections.execution_readiness,
    ):
        _validate_refs(section.evidence_refs, catalogs, require_main=True, main_id=main_id)
    if inputs["auxiliary"]:
        if output.key_changes is None:
            raise ValueError("已选择辅助报告，但全局分析没有返回跨版本变化判断")
        _validate_refs(output.key_changes.evidence_refs, catalogs, require_main=False, main_id=main_id)
        report_ids = {item.report_id for item in output.key_changes.evidence_refs}
        if main_id not in report_ids or not any(item != main_id for item in report_ids):
            raise ValueError("跨版本变化判断必须同时引用主报告和至少一份辅助报告")
    elif output.key_changes is not None:
        raise ValueError("未选择辅助报告，不允许输出跨版本变化判断")

    existing = _validate_existing_drafts(output.existing_case_recommendations, inputs, catalogs)
    scopes: dict[str, dict] = {}
    for scope in output.modules:
        module = main_modules.get(scope.module)
        if module is None:
            raise ValueError(f"回归范围引用了报告中不存在的模块：{scope.module}")
        if scope.module in scopes:
            raise ValueError(f"回归范围重复声明模块：{scope.module}")
        _validate_refs(scope.evidence_refs, catalogs, require_main=True, main_id=main_id)
        allowed = {module["ref"], *(record["ref"] for record in module.get("records", []))}
        if not any(ref.report_id == main_id and ref.evidence_ref in allowed for ref in scope.evidence_refs):
            raise ValueError(f"回归范围缺少所属模块的证据：{scope.module}")
        scopes[scope.module] = scope.model_dump()

    def cited_main_modules(evidence_refs: list[EvidenceRef]) -> set[str]:
        return {
            name
            for name, module in main_modules.items()
            if any(
                ref.report_id == main_id
                and ref.evidence_ref in {module["ref"], *(record["ref"] for record in module.get("records", []))}
                for ref in evidence_refs
            )
        }

    merged_targets: dict[tuple[str, str, str], dict] = {}
    priority_rank = {"low": 0, "medium": 1, "high": 2}
    for target in output.new_case_targets:
        _validate_refs(target.evidence_refs, catalogs, require_main=True, main_id=main_id)
        cited_modules = cited_main_modules(target.evidence_refs)
        if len(cited_modules) >= 2:
            normalized_module = "跨模块"
        elif target.module == "跨模块":
            raise ValueError("跨模块新增目标必须引用至少两个模块的主报告证据")
        elif len(cited_modules) == 1:
            evidence_module = next(iter(cited_modules))
            if target.module != evidence_module:
                raise ValueError(
                    f"新增目标声明的模块与证据所属模块不一致：{target.module}（证据所属模块：{evidence_module}）"
                )
            normalized_module = evidence_module
        else:
            raise ValueError("新增目标必须引用至少一个真实模块的主报告证据")
        data = target.model_dump()
        # The evidence, not a model-generated composite label, determines module ownership.
        data["module"] = normalized_module
        key = (normalized_module, target.title.strip().casefold(), target.test_item.strip().casefold())
        current = merged_targets.get(key)
        if current is None:
            merged_targets[key] = data
            continue
        for field in ("reason", "coverage_gap"):
            current[field] = "；".join(dict.fromkeys([current[field], data[field]]))[:2000]
        current["evidence_refs"] = list(
            {
                (ref["report_id"], ref["evidence_ref"]): ref
                for ref in [*current["evidence_refs"], *data["evidence_refs"]]
            }.values()
        )
        if priority_rank[data["priority"]] > priority_rank[current["priority"]]:
            current["priority"] = data["priority"]

    targets = []
    for target in (RegressionNewCaseTarget.model_validate(item) for item in merged_targets.values()):
        _validate_refs(target.evidence_refs, catalogs, require_main=True, main_id=main_id)
        cited_modules = cited_main_modules(target.evidence_refs)
        if target.module == "跨模块":
            if len(cited_modules) < 2:
                raise ValueError("跨模块新增目标必须引用至少两个模块的主报告证据")
        elif target.module not in main_modules or cited_modules != {target.module}:
            raise ValueError(f"新增目标必须引用所属模块的主报告证据：{target.module}")
        if target.module != "跨模块":
            module = main_modules[target.module]
            for record in module.get("records", []):
                if record["title"].strip() == target.title.strip() and any(
                    ref.report_id == main_id and ref.evidence_ref == record["ref"] for ref in target.evidence_refs
                ):
                    raise ValueError("新增目标与报告中已有用例完全重合，不得重复创建")
        targets.append(target.model_dump())

    merged_notes: dict[str, dict] = {}
    for note in output.review_notes:
        _validate_refs(note.evidence_refs, catalogs, require_main=True, main_id=main_id)
        current = merged_notes.get(note.content)
        if current is None:
            merged_notes[note.content] = note.model_dump()
            continue
        current["evidence_refs"] = list(
            {
                (ref["report_id"], ref["evidence_ref"]): ref
                for ref in [*current["evidence_refs"], *note.model_dump()["evidence_refs"]]
            }.values()
        )
    review_notes = list(merged_notes.values())

    for item in [*existing, *targets]:
        module_name = item["module"]
        if module_name != "跨模块" and module_name in main_modules and module_name not in scopes:
            scopes[module_name] = {
                "module": module_name,
                "priority": item["priority"],
                "reason": item.get("reason") or item.get("coverage_gap") or "报告证据支持回归验证",
                "evidence_refs": item["evidence_refs"],
            }
    return {
        "analysis_sections": output.analysis_sections.model_dump(),
        "key_changes": output.key_changes.model_dump() if output.key_changes else None,
        "summary": output.summary,
        "modules": list(scopes),
        "module_scopes": list(scopes.values()),
        "existing_case_recommendations": existing,
        "new_case_targets": targets,
        "review_notes": review_notes,
    }


def _validate_global_synthesis_output(
    raw: dict,
    inputs: dict,
    catalogs: dict,
    module_outputs: list[dict],
) -> dict:
    output = RegressionGlobalSynthesisOutput.model_validate(raw)
    module_analyses = [item for batch_output in module_outputs for item in batch_output.get("module_analyses", [])]
    merged = {
        "analysis_sections": output.analysis_sections.model_dump(),
        "key_changes": output.key_changes.model_dump() if output.key_changes else None,
        "summary": output.summary,
        "modules": [item.model_dump() for item in output.modules],
        "existing_case_recommendations": [
            item for analysis in module_analyses for item in analysis.get("existing_case_recommendations", [])
        ],
        "new_case_targets": [
            *[item for analysis in module_analyses for item in analysis.get("new_case_targets", [])],
            *[item.model_dump() for item in output.new_case_targets],
        ],
        "review_notes": [
            *[item for analysis in module_analyses for item in analysis.get("review_notes", [])],
            *[item.model_dump() for item in output.review_notes],
        ],
    }
    return _validate_global_output(merged, inputs, catalogs)


class ModuleAnalysisCoverageError(ValueError):
    """The model output does not contain exactly one result for each requested module."""


def _validate_module_analysis(raw: dict, unit: dict, inputs: dict, catalogs: dict) -> dict:
    output = RegressionModuleAnalysisOutput.model_validate(raw)
    expected = set(unit["module_names"])
    actual = [item.module for item in output.module_analyses]
    actual_set = set(actual)
    if len(actual) != len(actual_set) or actual_set != expected:
        missing = sorted(expected - actual_set)
        unexpected = sorted(actual_set - expected)
        duplicates = sorted(name for name in actual_set if actual.count(name) > 1)
        raise ModuleAnalysisCoverageError(
            "模块证据分析必须对本批每个模块恰好返回一份结果；"
            f"本批模块={sorted(expected)}，实际返回={actual}，"
            f"缺失={missing or []}，重复={duplicates or []}，多余={unexpected or []}"
        )
    main_id = inputs["main"]["report_id"]
    for analysis in output.module_analyses:
        for finding in analysis.findings:
            _validate_refs(finding.evidence_refs, catalogs, require_main=True, main_id=main_id)
        _validate_existing_drafts(analysis.existing_case_recommendations, inputs, catalogs)
        for target in analysis.new_case_targets:
            if target.module != analysis.module:
                raise ValueError("模块级新增目标不得跨出当前模块")
            _validate_refs(target.evidence_refs, catalogs, require_main=True, main_id=main_id)
            module = next(item for item in inputs["main"]["facts"]["modules"] if item["name"] == analysis.module)
            allowed = {module["ref"], *(record["ref"] for record in module["records"])}
            if not any(ref.report_id == main_id and ref.evidence_ref in allowed for ref in target.evidence_refs):
                raise ValueError("模块级新增目标必须引用所属模块证据")
        for note in analysis.review_notes:
            _validate_refs(note.evidence_refs, catalogs, require_main=True, main_id=main_id)
    return output.model_dump()


def _regression_synthesis_input(module_outputs: list[dict], inputs: dict, catalogs: dict) -> dict:
    module_analyses = []
    for batch_output in module_outputs:
        for analysis in batch_output["module_analyses"]:
            module_analyses.append(
                {
                    "module": analysis["module"],
                    "summary": analysis["summary"],
                    "findings": analysis["findings"],
                    "existing_case_count": len(analysis["existing_case_recommendations"]),
                    "existing_cases": [
                        {"case_number": item["case_number"], "priority": item["priority"]}
                        for item in analysis["existing_case_recommendations"]
                    ],
                    "new_target_count": len(analysis["new_case_targets"]),
                    "new_targets": [
                        {
                            "title": item["title"],
                            "test_item": item["test_item"],
                            "priority": item["priority"],
                            "coverage_gap": item["coverage_gap"],
                            "evidence_refs": item["evidence_refs"],
                        }
                        for item in analysis["new_case_targets"]
                    ],
                    "review_notes": analysis["review_notes"],
                }
            )
    return {**_regression_global_context(inputs), "module_analyses": module_analyses}


def _request_module_analysis(
    unit: dict,
    inputs: dict,
    catalogs: dict,
    request_json,
    on_recovery=None,
) -> dict:
    """Retry a coverage-invalid batch once as independent, exact-name module requests."""
    stage = "intelligent_regression_module"
    payload = unit["payload"]
    try:
        raw = request_json(stage, _regression_module_prompt(unit["module_names"]), payload)
        return _validate_module_analysis(raw, unit, inputs, catalogs)
    except ModuleAnalysisCoverageError as original_error:
        recovered_analyses = []
        for module in payload["modules"]:
            module_name = module["name"]
            if on_recovery is not None:
                on_recovery(module_name)
            single_unit = {
                **unit,
                "module_names": [module_name],
                "payload": {**payload, "modules": [module]},
            }
            raw = request_json(
                stage,
                _regression_module_prompt([module_name], recovery=True),
                single_unit["payload"],
            )
            single_output = _validate_module_analysis(raw, single_unit, inputs, catalogs)
            recovered_analyses.extend(single_output["module_analyses"])

        try:
            return _validate_module_analysis({"module_analyses": recovered_analyses}, unit, inputs, catalogs)
        except (ValidationError, ValueError, TypeError) as recovery_error:
            raise ValueError(
                "模块分析批次校验失败，已按单模块补救一次但仍未通过；"
                f"首次错误：{original_error}；补救错误：{recovery_error}"
            ) from recovery_error


def _build_regression_detail_units(
    global_output: dict,
    inputs: dict,
    catalogs: dict,
    config,
    *,
    max_targets_per_batch: int = DETAIL_TARGETS_PER_BATCH,
    target_batches: list[list[str]] | None = None,
) -> list[dict]:
    targets = global_output["new_case_targets"]
    if not targets:
        return []
    main_modules = {item["name"]: item for item in inputs["main"]["facts"].get("modules", [])}
    targets_with_ids = [{**target, "target_id": _digest(target)[:24]} for target in targets]

    def make_payload(group: list[dict]) -> dict:
        targets_by_module: dict[str, set[str]] = {}
        for target in group:
            cited = {
                ref["evidence_ref"]
                for ref in target["evidence_refs"]
                if ref["report_id"] == inputs["main"]["report_id"]
            }
            if target["module"] == "跨模块":
                names = [
                    name
                    for name, module in main_modules.items()
                    if module["ref"] in cited or any(record["ref"] in cited for record in module["records"])
                ]
            else:
                names = [target["module"]]
            for name in names:
                targets_by_module.setdefault(name, set()).update(cited)

        report_modules = []
        for name, cited in targets_by_module.items():
            module = main_modules[name]
            records_by_number = {record["case_number"]: record for record in module["records"]}
            selected_existing_cases = []
            for item in global_output["existing_case_recommendations"]:
                if item["module"] != name:
                    continue
                record = records_by_number.get(item["case_number"])
                selected_existing_cases.append(
                    {
                        "case_number": item["case_number"],
                        "title": record["title"] if record else "",
                        "test_item": (record.get("test_item") or "") if record else "",
                        "priority": item["priority"],
                        "reason": item["reason"][:300],
                    }
                )
            # Full immutable definitions are needed only for records directly cited
            # by this target. Selected existing cases stay as a compact duplicate-check index.
            related_records = [record for record in module["records"] if record["ref"] in cited]
            report_modules.append(
                {
                    "name": name,
                    "ref": module["ref"],
                    "conclusion": module["conclusion"],
                    "counts": module["counts"],
                    "related_records": [_ai_record_payload(record) for record in related_records],
                    "already_selected_existing_cases": selected_existing_cases,
                }
            )

        supporting = {}
        for target in group:
            for ref in target["evidence_refs"]:
                key = (ref["report_id"], ref["evidence_ref"])
                supporting[key] = {
                    "report_id": ref["report_id"],
                    "evidence_ref": ref["evidence_ref"],
                    "finding": catalogs[ref["report_id"]][ref["evidence_ref"]],
                }
        return {
            "main_report": _report_context(inputs["main"]),
            "product_profile": inputs.get("product_profile"),
            "version_ai_context": inputs.get("version_ai_context") or "",
            "analysis_sections": global_output["analysis_sections"],
            "targets": group,
            "modules": report_modules,
            "supporting_evidence": list(supporting.values()),
        }

    if max_targets_per_batch < 1:
        raise ValueError("每个详细生成批次至少需要一个回归目标")
    default_pending = [
        targets_with_ids[index : index + max_targets_per_batch]
        for index in range(0, len(targets_with_ids), max_targets_per_batch)
    ]
    target_by_id = {target["target_id"]: target for target in targets_with_ids}
    saved_ids = (
        [target_id for group in target_batches if isinstance(group, list) for target_id in group]
        if isinstance(target_batches, list)
        else []
    )
    saved_batches_valid = (
        isinstance(target_batches, list)
        and bool(target_batches)
        and all(isinstance(group, list) and 0 < len(group) <= max_targets_per_batch for group in target_batches)
        and len(saved_ids) == len(set(saved_ids))
        and set(saved_ids) == set(target_by_id)
    )
    pending = (
        [[target_by_id[target_id] for target_id in group] for group in target_batches]
        if saved_batches_valid
        else default_pending
    )
    units = []
    while pending:
        group = pending.pop(0)
        payload = make_payload(group)
        prompt = _regression_detail_prompt()
        try:
            preflight_budget(
                prompt + json.dumps(payload, ensure_ascii=False),
                config,
                stage="intelligent_regression_detail",
            )
        except SiliconFlowError as error:
            if error.kind != ModelErrorKind.INVALID_REQUEST:
                raise
            if len(group) <= 1:
                raise
            midpoint = len(group) // 2
            pending = [group[:midpoint], group[midpoint:], *pending]
            continue
        module_names = list(dict.fromkeys(item["module"] for item in group))
        units.append(
            {
                "key": _digest({"phase": "detail", "payload": payload, "prompt": DETAIL_PROMPT_VERSION})[:24],
                "target_ids": [item["target_id"] for item in group],
                "module_names": module_names,
                "payload": payload,
            }
        )
    return units


def _split_regression_detail_unit(unit: dict, global_output: dict, inputs: dict, catalogs: dict, config) -> list[dict]:
    """Allow one controlled fallback split; never recursively fan out into one request per target."""
    targets = unit["payload"]["targets"]
    if len(targets) <= DETAIL_FALLBACK_TARGETS_PER_BATCH:
        return []
    raw_targets = [{key: value for key, value in target.items() if key != "target_id"} for target in targets]
    midpoint = len(raw_targets) // 2
    split_units = []
    for group in (raw_targets[:midpoint], raw_targets[midpoint:]):
        scoped_global_output = {**global_output, "new_case_targets": group}
        split_units.extend(
            _build_regression_detail_units(
                scoped_global_output,
                inputs,
                catalogs,
                config,
                max_targets_per_batch=len(group),
            )
        )
    return split_units


def _validate_detail_output(raw: dict, unit: dict, inputs: dict, catalogs: dict) -> dict:
    output = RegressionDetailOutput.model_validate(raw)
    targets = {item["target_id"]: item for item in unit["payload"]["targets"]}
    target_ids = set(targets)
    candidate_targets: set[str] = set()
    deferred_targets: set[str] = set()
    main_id = inputs["main"]["report_id"]
    candidates = []
    for candidate in output.candidates:
        target = targets.get(candidate.target_id)
        if target is None:
            raise ValueError("新增用例引用了本批不存在的回归目标")
        if candidate.module != target["module"]:
            raise ValueError("新增用例模块与其回归目标不一致")
        if candidate.completion_status != "ready":
            raise ValueError("不完整的新用例必须进入待确认事项，不能作为可执行候选发布")
        _validate_refs(candidate.sources, catalogs, require_main=True, main_id=main_id)
        allowed = {(item["report_id"], item["evidence_ref"]) for item in target["evidence_refs"]}
        if not any((ref.report_id, ref.evidence_ref) in allowed for ref in candidate.sources):
            raise ValueError("新增用例必须引用其目标缺口的原始证据")
        if candidate.target_id in candidate_targets:
            raise ValueError("每个回归目标最多生成一条新增用例")
        candidate_targets.add(candidate.target_id)
        candidates.append(candidate.model_dump())

    deferred = []
    for item in output.deferred_targets:
        if item.target_id not in targets:
            raise ValueError("待确认事项引用了本批不存在的回归目标")
        if item.target_id in deferred_targets:
            raise ValueError("同一回归目标重复列入待确认事项")
        _validate_refs(item.evidence_refs, catalogs, require_main=True, main_id=main_id)
        allowed = {(ref["report_id"], ref["evidence_ref"]) for ref in targets[item.target_id]["evidence_refs"]}
        if not any((ref.report_id, ref.evidence_ref) in allowed for ref in item.evidence_refs):
            raise ValueError("待确认事项必须引用其回归目标的原始证据")
        deferred_targets.add(item.target_id)
        deferred.append(item.model_dump())

    if candidate_targets & deferred_targets:
        raise ValueError("同一回归目标不能同时作为可执行用例和待确认事项发布")
    if candidate_targets | deferred_targets != target_ids:
        missing = sorted(target_ids - candidate_targets - deferred_targets)
        raise ValueError(f"模型未处理全部回归目标：{', '.join(missing[:5])}")
    return {"candidates": candidates, "deferred_targets": deferred}


def _mock_module_analysis(unit: dict, inputs: dict) -> dict:
    analyses = []
    main_id = inputs["main"]["report_id"]
    recommendations = (inputs["main"].get("overall_analysis") or {}).get("regression_recommendations") or []
    for module in unit["payload"]["modules"]:
        existing = []
        for record in module["records"]:
            reasons = [
                item["content"]
                for item in recommendations
                if record["ref"] in item.get("evidence_refs", []) or module["ref"] in item.get("evidence_refs", [])
            ]
            if record["status"] not in {"failed", "blocked", "not_executed"} and not reasons:
                continue
            existing.append(
                {
                    "module": module["name"],
                    "priority": "high" if record["status"] in {"failed", "blocked"} else "medium",
                    "reason": "；".join(reasons) or record.get("message") or "报告记录存在未完成执行，建议复测原用例。",
                    "evidence_refs": [{"report_id": main_id, "evidence_ref": record["ref"]}],
                }
            )
        analyses.append(
            {
                "module": module["name"],
                "summary": module["conclusion"] or "模块测试事实已分析。",
                "findings": [
                    {
                        "content": module["conclusion"] or "模块测试事实已纳入分析。",
                        "evidence_refs": [{"report_id": main_id, "evidence_ref": module["ref"]}],
                    }
                ],
                "existing_case_recommendations": existing,
                "new_case_targets": [],
                "review_notes": [],
            }
        )
    return {"module_analyses": analyses}


def _mock_global_output(inputs: dict, catalogs: dict) -> dict:
    main = inputs["main"]
    facts = main["facts"]
    main_id = main["report_id"]
    analysis = main.get("overall_analysis") or {}
    refs = []
    for section in ("risks", "additional_verifications", "regression_recommendations", "test_directions"):
        for item in analysis.get(section) or []:
            refs.extend(item.get("evidence_refs") or [])
    for module in facts.get("modules", []):
        if module.get("counts", {}).get("failed", 0) or module.get("counts", {}).get("blocked", 0):
            refs.append(module["ref"])
            refs.extend(record["ref"] for record in module["records"] if record["status"] in {"failed", "blocked"})
    refs = [ref for ref in dict.fromkeys(refs) if ref in catalogs[main_id]]
    if not refs:
        refs = ["stage_progress"] if "stage_progress" in catalogs[main_id] else list(catalogs[main_id])[:1]
    evidence = [{"report_id": main_id, "evidence_ref": ref} for ref in refs[:30]]
    existing = []
    for module in facts.get("modules", []):
        for record in module.get("records", []):
            if record["status"] in {"failed", "blocked", "not_executed"}:
                existing.append(
                    {
                        "module": module["name"],
                        "case_number": record["case_number"],
                        "priority": "high" if record["status"] in {"failed", "blocked"} else "medium",
                        "reason": record.get("message") or "报告中该原用例未通过或未完成，建议按原定义复测。",
                        "evidence_refs": [{"report_id": main_id, "evidence_ref": record["ref"]}],
                    }
                )
    module_scopes = []
    for module in facts.get("modules", []):
        if any(item["module"] == module["name"] for item in existing):
            module_scopes.append(
                {
                    "module": module["name"],
                    "priority": "high"
                    if module["counts"].get("failed", 0) or module["counts"].get("blocked", 0)
                    else "medium",
                    "reason": module["conclusion"] or "模块存在需要复测的报告事实。",
                    "evidence_refs": [{"report_id": main_id, "evidence_ref": module["ref"]}],
                }
            )
    sections = {
        "regression_necessity": {
            "content": (
                "Mock 分析：报告中存在失败、阻塞或未完成用例，建议围绕这些已验证问题开展定向回归；"
                "是否扩大到全量回归，应结合后续版本变更范围确认。"
                if existing
                else "Mock 分析：当前报告未发现需要直接复测的失败、阻塞或未完成用例；暂不建议仅凭本报告扩大回归范围。"
            ),
            "evidence_refs": evidence,
        },
        "impact_analysis": {
            "content": (
                "Mock 分析：优先关注报告中失败/阻塞记录所属模块及其关联用例；"
                "未提供明确变更记录的功能不推断为发生了版本变化。"
            ),
            "evidence_refs": evidence,
        },
        "execution_strategy": {
            "content": (
                f"Mock 分析：优先复测 {len(existing)} 条报告中已存在的用例；本轮未从 Mock 数据中推断新增覆盖缺口。"
            ),
            "evidence_refs": evidence,
        },
        "execution_readiness": {
            "content": (
                "Mock 分析：执行前核对目标软件版本、设备状态、测试环境及原用例输入；"
                "报告未冻结的阈值和配置需依据产品规格确认，不得自行补造。"
            ),
            "evidence_refs": evidence,
        },
    }
    key_changes = None
    if inputs["auxiliary"]:
        key_changes = {
            "content": "Mock 分析：已纳入辅助报告进行事实对照；具体产品功能变更仅以报告中明确记录的差异为准。",
            "evidence_refs": [
                {"report_id": main_id, "evidence_ref": "stage_progress"},
                {"report_id": inputs["auxiliary"][0]["report_id"], "evidence_ref": "stage_progress"},
            ],
        }
    return {
        "analysis_sections": sections,
        "key_changes": key_changes,
        "summary": f"已完成 Mock 回归分析：识别 {len(existing)} 条已有用例复测建议，未自动虚构新增用例。",
        "modules": module_scopes,
        "existing_case_recommendations": existing,
        "new_case_targets": [],
        "review_notes": [],
    }


def _mock_global_synthesis_output(inputs: dict, catalogs: dict) -> dict:
    full = _mock_global_output(inputs, catalogs)
    return {
        "analysis_sections": {
            name: {
                "content": section["content"][:200],
                "evidence_refs": section["evidence_refs"][:3],
            }
            for name, section in full["analysis_sections"].items()
        },
        "key_changes": (
            {
                "content": full["key_changes"]["content"][:200],
                "evidence_refs": full["key_changes"]["evidence_refs"][:3],
            }
            if full["key_changes"]
            else None
        ),
        "summary": full["summary"][:200],
        "modules": [
            {
                **item,
                "reason": item["reason"][:200],
                "evidence_refs": item["evidence_refs"][:3],
            }
            for item in full["modules"]
        ],
        "existing_case_recommendations": [],
        "new_case_targets": [],
        "review_notes": [],
    }


def _mock_detail_output(unit: dict) -> dict:
    return {
        "candidates": [],
        "deferred_targets": [
            {
                "target_id": target["target_id"],
                "reason": "Mock 模式不生成未经真实模型分析的正式用例；请在真实 AI 配置下生成完整步骤和预期结果。",
                "evidence_refs": target["evidence_refs"],
            }
            for target in unit["payload"]["targets"]
        ],
    }


def _source_findings(sources: list[dict], versions: dict[int, str], catalogs: dict) -> list[SourceFinding]:
    return [
        SourceFinding(
            **source,
            product_version=versions[source["report_id"]],
            finding=catalogs[source["report_id"]][source["evidence_ref"]],
        )
        for source in sources
    ]


def _build_result(result: dict, inputs: dict, catalogs: dict, lease, *, is_mock: bool) -> RegressionResult:
    main = inputs["main"]
    reports = [main, *inputs["auxiliary"]]
    versions = {report["report_id"]: report["product_version"] for report in reports}
    candidates = []
    for index, raw_candidate in enumerate(result["candidates"], 1):
        candidate = {key: value for key, value in raw_candidate.items() if key != "target_id"}
        sources = candidate["sources"]
        candidates.append(
            RegressionCandidate(
                **candidate,
                id=index,
                source_findings=_source_findings(sources, versions, catalogs),
            )
        )

    records_by_case = {
        (module["name"], record["case_number"]): record
        for module in main["facts"]["modules"]
        for record in module["records"]
    }
    existing_case_recommendations = []
    for index, recommendation in enumerate(result["existing_case_recommendations"], 1):
        key = (recommendation["module"], recommendation["case_number"])
        record = records_by_case.get(key)
        if record is None:
            raise ValueError(
                f"复测建议无法映射到主报告原用例：{recommendation['module']} / {recommendation['case_number']}"
            )
        sources = [EvidenceRef.model_validate(source) for source in recommendation["evidence_refs"]]
        if not any(
            source.report_id == main["report_id"] and source.evidence_ref == record["ref"] for source in sources
        ):
            raise ValueError(f"复测建议 {recommendation['case_number']} 缺少原用例自身的报告证据")
        existing_case_recommendations.append(
            RegressionExistingCase(
                id=index,
                case_number=recommendation["case_number"],
                title=record["title"],
                module=recommendation["module"],
                source=record["source"],
                status=record["status"],
                priority=recommendation["priority"],
                reason=recommendation["reason"],
                sources=sources,
                source_findings=_source_findings([source.model_dump() for source in sources], versions, catalogs),
            )
        )

    review_notes = [
        RegressionReviewNote(
            content=item["content"],
            source_findings=_source_findings(item["evidence_refs"], versions, catalogs),
        )
        for item in result.get("review_notes", [])
    ]
    deferred_targets = [
        RegressionDeferredTargetResult(
            module=item["module"],
            title=item["title"],
            reason=item["reason"],
            source_findings=_source_findings(item["evidence_refs"], versions, catalogs),
        )
        for item in result.get("deferred_targets", [])
    ]
    modules = list(
        dict.fromkeys(
            [
                *result.get("modules", []),
                *(candidate.module for candidate in candidates),
                *(item.module for item in existing_case_recommendations),
                *(item.module for item in deferred_targets),
            ]
        )
    )
    return RegressionResult(
        schema_version=2,
        generation_status="complete_ai",
        project_id=inputs["project_id"],
        main_report_id=main["report_id"],
        main_product_version_id=inputs["main_product_version_id"],
        auxiliary_report_ids=[report["report_id"] for report in inputs["auxiliary"]],
        input_fingerprint=_digest(inputs),
        ai_context_fingerprint=_digest(inputs["version_ai_context"]),
        report_fingerprints={report["report_id"]: report["fact_fingerprint"] for report in reports},
        invocation_id=lease.invocation_id,
        config_fingerprint=lease.config_snapshot["fingerprint"],
        is_mock=is_mock,
        generated_at=datetime.now(UTC).isoformat(),
        prompt_version=PROMPT_VERSION,
        analysis_sections=result["analysis_sections"],
        key_changes=result["key_changes"],
        review_notes=review_notes,
        deferred_targets=deferred_targets,
        summary=result["summary"],
        modules=modules,
        existing_case_recommendations=existing_case_recommendations,
        candidate_count=len(candidates),
        candidates=candidates,
    )


def _current_row(connection, project_id: int):
    return connection.execute(
        "SELECT * FROM current_regression_recommendations WHERE project_id = ?", (project_id,)
    ).fetchone()


def _read_current(connection, project_id: int) -> dict:
    row = _current_row(connection, project_id)
    return {
        "project_id": project_id,
        "result": RegressionResult.model_validate_json(row["payload"]) if row else None,
    }


def _report_project(connection, report_id: int) -> int:
    row = connection.execute(
        """SELECT v.project_id FROM online_reports r
           JOIN product_versions v ON v.id = r.product_version_id WHERE r.id = ?""",
        (report_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "主报告不存在")
    return int(row["project_id"])


@router.get("/api/test-groups/{group_id}/intelligent-regression/current")
def current_regression_for_group(group_id: int) -> dict:
    with open_database() as connection:
        row = connection.execute(
            """SELECT v.project_id FROM test_groups g
               JOIN product_versions v ON v.id = g.product_version_id WHERE g.id = ?""",
            (group_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "测试组不存在")
        return _read_current(connection, int(row["project_id"]))


@router.get(REPORT_ROUTE + "/current")
def current_regression_for_report(report_id: int) -> dict:
    with open_database() as connection:
        return _read_current(connection, _report_project(connection, report_id))


@router.get(REPORT_ROUTE + "/progress")
def intelligent_regression_progress(report_id: int) -> dict | None:
    """Expose the active regression phase without leaking report contents or model prompts."""
    with open_database() as connection:
        active = connection.execute(
            """SELECT invocation_id, started_at, cancel_requested_at
               FROM ai_active_invocation
               WHERE id = 1 AND status = 'running'
                 AND operation_type = 'intelligent_regression' AND resource_id = ?""",
            (report_id,),
        ).fetchone()
        if active is None:
            return None
        run = connection.execute(
            "SELECT status, plan_json FROM ai_batch_runs WHERE invocation_id = ?",
            (active["invocation_id"],),
        ).fetchone()
        if run is None:
            return {
                "invocation_id": active["invocation_id"],
                "status": "running",
                "started_at": active["started_at"],
                "stopping": active["cancel_requested_at"] is not None,
                "phase": "preparing",
                "current_batch_index": 0,
                "completed_batches": 0,
                "total_batches": None,
                "current_module": None,
                "stream_response_chars": 0,
                "stream_event_count": 0,
                "stream_last_chunk_at": None,
            }
        plan = json.loads(run["plan_json"] or "{}")
        completed = plan.get("completed_batch_keys", [])
        return {
            "invocation_id": active["invocation_id"],
            "status": run["status"],
            "started_at": active["started_at"],
            "stopping": active["cancel_requested_at"] is not None,
            "phase": plan.get("phase", "preparing"),
            "current_batch_index": plan.get("current_batch_index", 0),
            "completed_batches": len(completed) if isinstance(completed, list) else 0,
            "total_batches": plan.get("regression_batch_count"),
            "current_module": plan.get("current_module"),
            "stream_response_chars": plan.get("stream_response_chars", 0),
            "stream_event_count": plan.get("stream_event_count", 0),
            "stream_last_chunk_at": plan.get("stream_last_chunk_at"),
        }


def _same_input(row, fingerprint: str, config_fingerprint: str, is_mock: bool) -> bool:
    if not (
        row
        and row["input_fingerprint"] == fingerprint
        and row["config_fingerprint"] == config_fingerprint
        and row["prompt_version"] == PROMPT_VERSION
        and bool(row["is_mock"]) == is_mock
    ):
        return False
    try:
        saved = RegressionResult.model_validate_json(row["payload"])
    except (ValidationError, ValueError, TypeError):
        return False
    return saved.generation_status == "complete_ai"


def _saved_regression_plan(invocation_id: str | None) -> dict:
    if not invocation_id:
        return {}
    with open_database() as connection:
        row = connection.execute(
            "SELECT plan_json FROM ai_batch_runs WHERE invocation_id = ?",
            (invocation_id,),
        ).fetchone()
    if row is None:
        return {}
    try:
        value = json.loads(row["plan_json"] or "{}")
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


@router.post(REPORT_ROUTE + "/repeat-info")
def regression_repeat_info(report_id: int, selection: RegressionAuxiliarySelection) -> dict:
    with open_database() as connection:
        connection.execute("BEGIN")
        inputs, catalogs = load_inputs(connection, report_id, sorted(selection.report_ids))
        project_id = inputs["project_id"]
        row = _current_row(connection, project_id)
        config = get_selected_snapshot(connection)
        if config is None:
            raise HTTPException(409, "智能回归必须调用 AI；请先完成 AI 配置并通过连接测试")
        fingerprint = _digest(inputs)
        is_mock = current_settings().mode == "mock"
        same = _same_input(row, fingerprint, config["fingerprint"], is_mock)
        batch_settings = _regression_batch_config()
        units = _regression_evidence_units(inputs, catalogs, batch_settings)
        plan = _regression_plan_metadata(units, inputs)
        resumable = resume_source(
            "intelligent_regression",
            report_id,
            fingerprint,
            config["fingerprint"],
            expected_plan=_resume_plan_expectation(plan),
        )
        completed = completed_units(resumable)
        previous_plan = _saved_regression_plan(resumable)
    active = get_active_invocation().active
    own = bool(active and active.operation_type == "intelligent_regression" and active.project_id == project_id)
    completed_modules = list(
        dict.fromkeys(name for unit in units if unit["key"] in completed for name in unit["module_names"])
    )
    return {
        "same_input": same,
        "has_previous": row is not None,
        "running_same_operation": own,
        "occupied_other": bool(active and not own),
        "active_invocation_id": active.invocation_id if own else None,
        "resume_available": resumable is not None,
        "completed_batches": len(completed),
        "total_batches": previous_plan.get("regression_batch_count", len(units) + 1),
        "completed_modules": completed_modules,
        "total_modules": len({name for unit in units for name in unit["module_names"]}),
    }


def _save_current(connection, result: RegressionResult) -> None:
    connection.execute(
        """INSERT INTO current_regression_recommendations
           (project_id, invocation_id, input_fingerprint, config_fingerprint,
            prompt_version, is_mock, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET invocation_id=excluded.invocation_id,
           input_fingerprint=excluded.input_fingerprint, config_fingerprint=excluded.config_fingerprint,
           prompt_version=excluded.prompt_version, is_mock=excluded.is_mock,
           payload=excluded.payload, created_at=excluded.created_at""",
        (
            result.project_id,
            result.invocation_id,
            result.input_fingerprint,
            result.config_fingerprint,
            result.prompt_version,
            int(result.is_mock),
            result.model_dump_json(),
            result.generated_at,
        ),
    )


@router.post(REPORT_ROUTE, response_model=RegressionResult)
def generate_regression(
    report_id: int, selection: RegressionAuxiliarySelection, force: bool = False
) -> RegressionResult:
    with open_database() as connection:
        connection.execute("BEGIN")
        inputs, catalogs = load_inputs(connection, report_id, sorted(selection.report_ids))

    batch_settings = _regression_batch_config()
    evidence_units = _regression_evidence_units(inputs, catalogs, batch_settings)
    plan = _regression_plan_metadata(evidence_units, inputs)
    fingerprint = _digest(inputs)
    with open_database() as connection:
        config_row = get_selected_snapshot(connection)
        if config_row is None:
            raise HTTPException(409, "智能回归必须调用 AI；请先完成 AI 配置并通过连接测试")
        config_fingerprint = config_row["fingerprint"]
        is_mock = current_settings().mode == "mock"
        resumed_from = (
            resume_source(
                "intelligent_regression",
                report_id,
                fingerprint,
                config_fingerprint,
                expected_plan=_resume_plan_expectation(plan),
            )
            if selection.resume
            else None
        )
        resumed_plan = None
        if resumed_from is not None:
            prior_run = connection.execute(
                "SELECT plan_json FROM ai_batch_runs WHERE invocation_id = ?", (resumed_from,)
            ).fetchone()
            if prior_run and prior_run["plan_json"]:
                try:
                    candidate_plan = json.loads(prior_run["plan_json"])
                except (TypeError, ValueError):
                    candidate_plan = None
                if isinstance(candidate_plan, dict):
                    resumed_plan = candidate_plan
    if selection.resume and resumed_from is None:
        raise HTTPException(409, "没有与当前报告、AI 配置和证据分析计划匹配的有效检查点，请选择重新生成")

    lease = begin_invocation(
        operation_type="intelligent_regression",
        project_id=inputs["project_id"],
        resource_id=report_id,
        execution_mode="checkpointed_batch",
        input_fingerprint=fingerprint,
        resumed_from_invocation_id=resumed_from,
    )
    outcome: Literal["completed", "failed", "cancelled"] = "failed"
    adapter = None
    checkpoints = RegressionCheckpoints(lease, resumed_from)
    completed_keys: set[str] = set(checkpoints.previous)
    current_module: str | None = None
    current_stage = "preparing"

    try:
        config = lease.config_snapshot
        with open_database() as connection:
            previous = _current_row(connection, inputs["project_id"])
            if not force and _same_input(previous, fingerprint, config["fingerprint"], is_mock):
                raise HTTPException(409, "输入与当前建议相同，结果可能重复；请选择重新执行或取消")

        if lease.cancel_requested():
            raise AiInvocationCancelled("智能回归已取消")

        if not is_mock:
            adapter = get_provider_adapter(config["provider"])
            if hasattr(adapter, "request_log_sink"):
                adapter.request_log_sink = save_request_logs
            adapter.network_mode = config["network_mode"]
            adapter._endpoint = config["endpoint"]
            adapter._cancel_event = lease.cancel_requested
            adapter.max_calls = batch_settings.call_limit
        save_plan(lease.invocation_id, plan)

        def request_json(stage: str, prompt: str, payload: dict) -> dict:
            if adapter is None:
                raise RuntimeError("真实 AI 适配器尚未初始化")
            evidence = json.dumps(payload, ensure_ascii=False)
            request_config = (
                _regression_detail_batch_config(config["provider"], config["model"], batch_settings)
                if stage == "intelligent_regression_detail"
                else batch_settings
            )
            preflight_budget(prompt + evidence, request_config, stage=stage)
            _update_regression_plan(
                lease.invocation_id,
                {
                    "stream_response_chars": 0,
                    "stream_event_count": 0,
                    "stream_last_chunk_at": None,
                },
            )
            progress_state = {"response_chars": 0, "event_count": 0}
            last_progress_write = 0.0

            def on_stream_progress(response_chars: int, event_count: int) -> None:
                nonlocal last_progress_write
                progress_state["response_chars"] = response_chars
                progress_state["event_count"] = event_count
                now = time.monotonic()
                if now - last_progress_write < 1.0:
                    return
                last_progress_write = now
                try:
                    _update_regression_plan(
                        lease.invocation_id,
                        {
                            "stream_response_chars": response_chars,
                            "stream_event_count": event_count,
                            "stream_last_chunk_at": datetime.now(UTC).isoformat(),
                        },
                    )
                except Exception:
                    # Progress telemetry must not abort the actual model request.
                    pass

            try:
                request_options = _regression_request_options(
                    config["provider"], config["model"], request_config, stage=stage
                )
                prompt_version = (
                    DETAIL_PROMPT_VERSION
                    if stage == "intelligent_regression_detail"
                    else GLOBAL_SYNTHESIS_VERSION
                    if stage == "intelligent_regression_global"
                    else PROMPT_VERSION
                )
                return adapter.generate_json(
                    api_key=configured_api_key(config["provider"]),
                    model=config["model"],
                    evidence_json=evidence,
                    system_prompt=prompt,
                    prompt_version=prompt_version,
                    stage=stage,
                    on_stream_progress=on_stream_progress,
                    **request_options,
                )
            finally:
                try:
                    _update_regression_plan(
                        lease.invocation_id,
                        {
                            "stream_response_chars": progress_state["response_chars"],
                            "stream_event_count": progress_state["event_count"],
                            "stream_last_chunk_at": datetime.now(UTC).isoformat()
                            if progress_state["event_count"]
                            else None,
                        },
                    )
                except Exception:
                    pass

        global_output: dict
        synthesis_key: str | None = None
        if len(evidence_units) == 1 and evidence_units[0]["kind"] == "global":
            unit = evidence_units[0]
            current_module = "全局回归范围与影响分析"
            current_stage = "global_analysis"
            cached = checkpoints.get(unit["key"])
            if cached is not None:
                try:
                    global_output = _validate_global_output(cached, inputs, catalogs)
                except (ValidationError, ValueError, TypeError) as error:
                    raise ValueError(f"已保存的全局分析检查点校验失败，请重新生成：{error}") from error
            else:
                _update_regression_plan(
                    lease.invocation_id,
                    {
                        "phase": current_stage,
                        "current_batch_index": 1,
                        "current_module": current_module,
                        "completed_batch_keys": sorted(completed_keys),
                    },
                )
                raw = (
                    _mock_global_output(inputs, catalogs)
                    if is_mock
                    else request_json("intelligent_regression_global", _regression_global_prompt(), unit["payload"])
                )
                global_output = _validate_global_output(raw, inputs, catalogs)
                checkpoint = RegressionGlobalOutput.model_validate(raw).model_dump()
                checkpoints.save(unit["key"], 0, checkpoint)
            completed_keys.add(unit["key"])
            evidence_keys = [unit["key"]]
        else:
            module_outputs = []
            for index, unit in enumerate(evidence_units, 1):
                if lease.cancel_requested():
                    raise AiInvocationCancelled("智能回归已取消")
                current_module = "、".join(unit["module_names"]) or "模块证据"
                current_stage = "module_analysis"
                cached = checkpoints.get(unit["key"])
                if cached is not None:
                    try:
                        module_output = _validate_module_analysis(cached, unit, inputs, catalogs)
                    except (ValidationError, ValueError, TypeError) as error:
                        raise ValueError(
                            f"已保存的模块分析检查点校验失败（{current_module}），请重新生成：{error}"
                        ) from error
                else:
                    _update_regression_plan(
                        lease.invocation_id,
                        {
                            "phase": current_stage,
                            "current_batch_index": index,
                            "current_module": current_module,
                            "completed_batch_keys": sorted(completed_keys),
                        },
                    )
                    if is_mock:
                        raw = _mock_module_analysis(unit, inputs)
                        module_output = _validate_module_analysis(raw, unit, inputs, catalogs)
                    else:

                        def mark_module_recovery(module_name: str) -> None:
                            _update_regression_plan(
                                lease.invocation_id,
                                {"current_module": f"{module_name}（单模块补救）"},
                            )

                        module_output = _request_module_analysis(
                            unit,
                            inputs,
                            catalogs,
                            request_json,
                            on_recovery=mark_module_recovery,
                        )
                    checkpoints.save(
                        unit["key"],
                        index - 1,
                        module_output,
                    )
                module_outputs.append(module_output)
                completed_keys.add(unit["key"])
                _update_regression_plan(
                    lease.invocation_id,
                    {
                        "phase": current_stage,
                        "current_batch_index": index,
                        "current_module": current_module,
                        "completed_batch_keys": sorted(completed_keys),
                    },
                )

            if lease.cancel_requested():
                raise AiInvocationCancelled("智能回归已取消")
            synthesis_payload = _regression_synthesis_input(module_outputs, inputs, catalogs)
            synthesis_key = _digest(
                {
                    "phase": "global_synthesis",
                    "payload": synthesis_payload,
                    "prompt": GLOBAL_SYNTHESIS_VERSION,
                }
            )[:24]
            current_module = "跨模块综合回归策略"
            current_stage = "global_synthesis"
            cached = checkpoints.get(synthesis_key)
            if cached is not None:
                try:
                    global_output = _validate_global_synthesis_output(cached, inputs, catalogs, module_outputs)
                except (ValidationError, ValueError, TypeError) as error:
                    raise ValueError(f"已保存的全局综合检查点校验失败，请重新生成：{error}") from error
            else:
                _update_regression_plan(
                    lease.invocation_id,
                    {
                        "phase": current_stage,
                        "current_batch_index": len(evidence_units) + 1,
                        "current_module": current_module,
                        "completed_batch_keys": sorted(completed_keys),
                    },
                )
                raw = (
                    _mock_global_synthesis_output(inputs, catalogs)
                    if is_mock
                    else request_json(
                        "intelligent_regression_global", _regression_synthesis_prompt(), synthesis_payload
                    )
                )
                global_output = _validate_global_synthesis_output(raw, inputs, catalogs, module_outputs)
                checkpoints.save(
                    synthesis_key,
                    len(evidence_units),
                    RegressionGlobalSynthesisOutput.model_validate(raw).model_dump(),
                )
            completed_keys.add(synthesis_key)
            evidence_keys = [unit["key"] for unit in evidence_units]

        if lease.cancel_requested():
            raise AiInvocationCancelled("智能回归已取消")

        detail_batch_settings = _regression_detail_batch_config(config["provider"], config["model"], batch_settings)
        saved_detail_batches = (
            resumed_plan.get("regression_detail_target_batches")
            if isinstance(resumed_plan, dict)
            and resumed_plan.get("detail_batch_layout_version") == DETAIL_BATCH_LAYOUT_VERSION
            else None
        )
        detail_units = _build_regression_detail_units(
            global_output,
            inputs,
            catalogs,
            detail_batch_settings,
            max_targets_per_batch=_regression_detail_batch_size(config["provider"], config["model"]),
            target_batches=saved_detail_batches,
        )
        all_batch_keys = [
            *evidence_keys,
            *([synthesis_key] if synthesis_key else []),
            *(unit["key"] for unit in detail_units),
        ]
        plan.update(
            {
                "regression_batch_keys": all_batch_keys,
                "regression_batch_count": len(all_batch_keys),
                "detail_batch_layout_version": DETAIL_BATCH_LAYOUT_VERSION,
                "regression_detail_target_batches": [unit["target_ids"] for unit in detail_units],
                "total_modules": len({name for unit in evidence_units for name in unit["module_names"]}),
            }
        )
        save_plan(lease.invocation_id, plan)

        candidates: list[dict] = []
        deferred: list[dict] = []
        detail_index = 0
        while detail_index < len(detail_units):
            index = detail_index + 1
            unit = detail_units[detail_index]
            if lease.cancel_requested():
                raise AiInvocationCancelled("智能回归已取消")
            current_module = "、".join(unit["module_names"]) or "回归场景"
            current_stage = "detail_generation"
            cached = checkpoints.get(unit["key"])
            if cached is not None:
                try:
                    detail_output = _validate_detail_output(cached, unit, inputs, catalogs)
                except (ValidationError, ValueError, TypeError) as error:
                    raise ValueError(
                        f"已保存的用例生成检查点校验失败（{current_module}），请重新生成：{error}"
                    ) from error
            else:
                _update_regression_plan(
                    lease.invocation_id,
                    {
                        "phase": current_stage,
                        "current_batch_index": len(evidence_keys) + (1 if synthesis_key else 0) + index,
                        "current_module": current_module,
                        "completed_batch_keys": sorted(completed_keys),
                    },
                )
                try:
                    raw = (
                        _mock_detail_output(unit)
                        if is_mock
                        else request_json("intelligent_regression_detail", _regression_detail_prompt(), unit["payload"])
                    )
                except SiliconFlowError as error:
                    if error.kind == ModelErrorKind.OUTPUT_TRUNCATED:
                        split_units = _split_regression_detail_unit(
                            unit, global_output, inputs, catalogs, detail_batch_settings
                        )
                        if split_units:
                            detail_units[detail_index : detail_index + 1] = split_units
                            all_batch_keys = [
                                *evidence_keys,
                                *([synthesis_key] if synthesis_key else []),
                                *(item["key"] for item in detail_units),
                            ]
                            plan.update(
                                {
                                    "regression_batch_keys": all_batch_keys,
                                    "regression_batch_count": len(all_batch_keys),
                                    "detail_batch_layout_version": DETAIL_BATCH_LAYOUT_VERSION,
                                    "regression_detail_target_batches": [item["target_ids"] for item in detail_units],
                                }
                            )
                            save_plan(lease.invocation_id, plan)
                            continue
                    raise
                detail_output = _validate_detail_output(raw, unit, inputs, catalogs)
                checkpoints.save(
                    unit["key"],
                    len(evidence_keys) + (1 if synthesis_key else 0) + index - 1,
                    RegressionDetailOutput.model_validate(raw).model_dump(),
                )
            candidates.extend(detail_output["candidates"])
            deferred.extend(detail_output["deferred_targets"])
            completed_keys.add(unit["key"])
            _update_regression_plan(
                lease.invocation_id,
                {
                    "phase": current_stage,
                    "current_batch_index": len(evidence_keys) + (1 if synthesis_key else 0) + index,
                    "current_module": current_module,
                    "completed_batch_keys": sorted(completed_keys),
                },
            )
            detail_index += 1
        if lease.cancel_requested():
            raise AiInvocationCancelled("智能回归已取消")

        candidate_map: dict[tuple[str, str, str, str, str], dict] = {}
        for candidate in candidates:
            key = (
                candidate["module"],
                candidate["case_type"],
                candidate["test_item"],
                candidate["title"],
                candidate["steps"],
            )
            existing = candidate_map.get(key)
            if existing is None:
                candidate_map[key] = candidate
                continue
            existing["reason"] = "；".join(dict.fromkeys([existing["reason"], candidate["reason"]]))[:4000]
            existing["sources"] = list(
                {
                    (source["report_id"], source["evidence_ref"]): source
                    for source in [*existing["sources"], *candidate["sources"]]
                }.values()
            )

        target_by_id = {_digest(target)[:24]: target for target in global_output["new_case_targets"]}
        deferred_results = []
        for item in deferred:
            target = target_by_id[item["target_id"]]
            deferred_results.append(
                {
                    "module": target["module"],
                    "title": target["title"],
                    "reason": item["reason"],
                    "evidence_refs": item["evidence_refs"],
                }
            )

        final_payload = {
            **global_output,
            "candidates": list(candidate_map.values()),
            "deferred_targets": deferred_results,
        }
        summary = global_output["summary"]
        summary += (
            f" 已确认复测 {len(global_output['existing_case_recommendations'])} 条已有用例，"
            f"新增 {len(candidate_map)} 条可执行回归用例，"
            f"{len(deferred_results)} 项因证据或规格不足列为待确认。"
        )
        final_payload["summary"] = summary
        current_stage = "validating"
        _update_regression_plan(
            lease.invocation_id,
            {
                "phase": current_stage,
                "current_batch_index": len(all_batch_keys),
                "current_module": None,
                "completed_batch_keys": sorted(completed_keys),
            },
        )
        result = _build_result(final_payload, inputs, catalogs, lease, is_mock=is_mock)

        if adapter is not None:
            save_request_logs(getattr(adapter, "request_logs", []))
            adapter = None
        current_stage = "publishing"
        with open_database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            lease.assert_can_commit(connection)
            _save_current(connection, result)
            if finish_invocation_in_transaction(connection, lease.invocation_id, status="completed") != "completed":
                raise AiInvocationCancelled("智能回归已取消")
            connection.commit()
        outcome = "completed"
        return result

    except AiInvocationCancelled as exc:
        outcome = "cancelled"
        raise HTTPException(
            409,
            "智能回归已取消，未发布新建议；上一份有效建议保持不变。",
        ) from exc
    except SiliconFlowError as exc:
        reasons = {
            ModelErrorKind.NETWORK: "模型响应传输中断",
            ModelErrorKind.CONNECTION: "模型连接失败",
            ModelErrorKind.DNS: "DNS 解析失败",
            ModelErrorKind.TLS: "TLS 安全连接失败",
            ModelErrorKind.PROXY: "代理连接失败",
            ModelErrorKind.TIMEOUT: "模型调用超时",
            ModelErrorKind.RATE_LIMIT: "模型服务限流",
            ModelErrorKind.TEMPORARY_SERVICE: "模型服务暂时不可用",
            ModelErrorKind.AUTHENTICATION: "模型鉴权失败",
            ModelErrorKind.PERMISSION: "模型访问权限不足",
            ModelErrorKind.INVALID_MODEL: "当前模型不可用",
            ModelErrorKind.INVALID_REQUEST: "模型输入或上下文预算无效",
            ModelErrorKind.OUTPUT_TRUNCATED: "模型输出被截断",
            ModelErrorKind.INVALID_RESPONSE: "模型响应格式无效",
            ModelErrorKind.MALFORMED_RESPONSE: "模型响应结构异常",
            ModelErrorKind.SCHEMA_VALIDATION: "模型输出未通过结构校验",
        }
        reason = reasons.get(exc.kind, "模型请求发生未分类错误")
        stage = exc.stage or current_stage
        detail = f"智能回归生成失败（{stage}）：{reason}（错误类型：{exc.kind}"
        if exc.diagnostic and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]{0,80}", exc.diagnostic):
            detail += f" · {exc.diagnostic}"
        if exc.response_chars is not None:
            detail += f" · 响应 {exc.response_chars} 字符"
        if exc.finish_reason is not None:
            detail += f" · finish_reason={exc.finish_reason}"
        if exc.http_status is not None:
            detail += f" · HTTP {exc.http_status}"
        if exc.elapsed_ms is not None:
            detail += f" · 耗时 {exc.elapsed_ms / 1000:.1f} 秒"
        if exc.diagnostic == "RemoteDisconnected":
            detail += "；远端是否已处理当前请求无法确认，继续时只会重试未保存单元，可能产生额外模型调用及费用"
        completed_count = len(completed_keys)
        if completed_count:
            detail += (
                f"；已保存 {completed_count}/{plan.get('regression_batch_count', len(evidence_units))} 个分析检查点，"
                "可选择继续复用已完成单元"
            )
        detail += "；本次未发布新建议，上一份有效建议保持不变。"
        raise HTTPException(422, detail) from exc
    except (ValidationError, ValueError, TypeError) as exc:
        if isinstance(exc, ValidationError):
            errors = exc.errors(include_input=False)[:5]
            diagnostic = "；".join(
                f"{'.'.join(str(part) for part in item.get('loc', []))}: {item.get('msg', '结构不符合要求')}"
                for item in errors
            )
        else:
            diagnostic = str(exc) or type(exc).__name__
        raise HTTPException(
            422,
            f"智能回归结果校验失败（{current_stage}）：{diagnostic}；未发布新建议，上一份有效建议保持不变。",
        ) from exc
    except sqlite3.Error as exc:
        raise HTTPException(500, "智能回归结果保存失败，上一份有效建议保持不变。") from exc
    finally:
        try:
            if adapter is not None:
                save_request_logs(getattr(adapter, "request_logs", []))
        finally:
            final = lease.finish(outcome)
        if final == "cancelled":
            raise HTTPException(409, "智能回归已取消，未发布新建议；上一份有效建议保持不变。")


@router.post(REPORT_ROUTE + "/cancel")
def cancel_regression(report_id: int) -> dict[str, bool]:
    active = get_active_invocation().active
    if not active or active.operation_type != "intelligent_regression" or active.resource_id != report_id:
        raise HTTPException(404, "当前报告没有正在运行的智能回归")
    request_invocation_cancel(active.invocation_id)
    return {"stopping": True}
