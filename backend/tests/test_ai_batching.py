import json
import sqlite3

import pytest

from app.ai_batching import (
    BatchConfig,
    batch_config,
    estimate_tokens,
    semantic_batches,
    split_batch,
)
from app.database import LATEST_SCHEMA_VERSION, migrate_database
from app.fact_report_models import ReportAnalysisOutput
from app.report_analysis_batching import run_batches
from app.siliconflow import ModelErrorKind, SiliconFlowError


class MemoryCheckpoints:
    def __init__(self) -> None:
        self.data: dict[str, dict] = {}

    def get(self, key):
        return self.data.get(key)

    def save(self, key, status, output, error, attempts):
        if status == "completed":
            self.data[key] = output
        else:
            self.data.pop(key, None)


def _module(index: int, records: int = 1) -> dict:
    return {
        "ref": f"module:{index}",
        "name": f"模块{index}",
        "conclusion": "需关注",
        "records": [
            {
                "ref": f"record:{index}:{record}",
                "case_number": f"CASE-{index}-{record}",
                "title": "用例",
                "source": "自动化",
                "status": "failed",
                "message": "失败",
            }
            for record in range(records)
        ],
    }


def _analysis_input(modules: int, records_per_module: int = 1) -> dict:
    return {
        "stage_progress": {"conclusion": "建议暂缓", "basis": ["失败 1 项"]},
        "modules": [_module(index, records_per_module) for index in range(modules)],
    }


def _output(batch: dict) -> dict:
    ref = next(ref for ref in batch["refs"] if ref != "stage_progress")
    items = [{"content": "建议", "evidence_refs": [ref]}]
    return {
        "risks": items,
        "additional_verifications": [],
        "regression_recommendations": [],
        "stage_recommendation": {
            "suggestion": "建议暂缓",
            "content": "仅作建议",
            "evidence_refs": ["stage_progress"],
        },
    }


def test_defaults_and_overrides_are_configurable(monkeypatch):
    config = batch_config()
    assert config.modules_per_batch == 6
    assert config.records_per_batch == 60
    assert config.cases_per_batch == 20
    assert config.output_reserve_tokens == 8192
    assert config.call_limit == 40

    monkeypatch.setenv("AI_BATCH_MODULES_PER_BATCH", "3")
    assert batch_config().modules_per_batch == 3
    assert batch_config({"modules_per_batch": 2}).modules_per_batch == 2
    with pytest.raises(ValueError):
        BatchConfig(modules_per_batch=21)


def test_semantic_batches_split_modules_and_records_not_characters():
    config = BatchConfig(modules_per_batch=2, records_per_batch=2)
    batches = semantic_batches(_analysis_input(3, records_per_module=3), config)
    assert len(batches) >= 3
    for batch in batches:
        assert len(batch["modules"]) <= 2
        for module in batch["modules"]:
            assert len(module["records"]) <= 2
    # 模块/记录使用稳定 ref，而不是自然语言位置。
    assert any("module:" in ref for ref in batches[0]["refs"])


def test_split_batch_halves_records_then_modules():
    config = BatchConfig(modules_per_batch=2, records_per_batch=4)
    batch = semantic_batches(_analysis_input(2, records_per_module=4), config)[0]
    parts = split_batch(batch)
    assert parts is not None
    assert sum(len(item["records"]) for item in parts[1]["modules"]) < sum(
        len(item["records"]) for item in batch["modules"]
    )
    single = semantic_batches(_analysis_input(1, records_per_module=1), config)[0]
    assert split_batch(single) is None


def test_budget_preflight_blocks_before_calling_model():
    called = 0

    def call(_batch):
        nonlocal called
        called += 1
        return _output(_batch)

    config = BatchConfig(context_token_limit=100, output_reserve_tokens=90)
    with pytest.raises(SiliconFlowError) as captured:
        run_batches(
            semantic_batches(_analysis_input(2), config),
            call_model=call,
            valid_refs={"stage_progress", "module:0", "module:1"},
            checkpoints=MemoryCheckpoints(),
            config=config,
        )
    assert captured.value.kind == ModelErrorKind.INVALID_REQUEST
    assert called == 0
    assert estimate_tokens("abcd") == 1


def test_truncated_batch_bisects_and_completes():
    config = BatchConfig(modules_per_batch=4, call_limit=10)
    batches = semantic_batches(_analysis_input(4), config)
    assert len(batches) == 1
    calls = 0

    def call(batch):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise SiliconFlowError(ModelErrorKind.OUTPUT_TRUNCATED, "截断", False, stage="report_analysis")
        return _output(batch)

    output = run_batches(
        batches,
        call_model=call,
        valid_refs={"stage_progress", "module:0", "module:1", "module:2", "module:3"},
        checkpoints=MemoryCheckpoints(),
        config=config,
    )
    assert isinstance(output, ReportAnalysisOutput)
    assert calls == 3


def test_single_semantic_unit_truncation_fails_explicitly():
    config = BatchConfig(modules_per_batch=1)
    batch = semantic_batches(_analysis_input(1), config)[0]

    def call(_batch):
        raise SiliconFlowError(ModelErrorKind.OUTPUT_TRUNCATED, "截断", False, stage="report_analysis")

    with pytest.raises(SiliconFlowError) as captured:
        run_batches(
            [batch],
            call_model=call,
            valid_refs={"stage_progress", "module:0"},
            checkpoints=MemoryCheckpoints(),
            config=config,
        )
    assert "更换" in captured.value.action


def test_resume_reuses_completed_checkpoints_without_calls():
    config = BatchConfig(modules_per_batch=1)
    batches = semantic_batches(_analysis_input(2), config)
    checkpoints = MemoryCheckpoints()
    refs = {"stage_progress", "module:0", "module:1"}
    calls = 0

    def call(batch):
        nonlocal calls
        calls += 1
        return _output(batch)

    run_batches(
        batches,
        call_model=call,
        valid_refs=refs,
        checkpoints=checkpoints,
        config=config,
    )
    assert calls == 2

    def no_call(_batch):
        raise AssertionError("已完成批次不应再次调用模型")

    resumed = run_batches(
        batches,
        call_model=no_call,
        valid_refs=refs,
        checkpoints=checkpoints,
        config=config,
    )
    assert isinstance(resumed, ReportAnalysisOutput)


def test_cancel_and_call_limit_are_enforced():
    config = BatchConfig(modules_per_batch=1, call_limit=1)
    batches = semantic_batches(_analysis_input(2), config)
    calls = 0

    def call(batch):
        nonlocal calls
        calls += 1
        return _output(batch)

    with pytest.raises(SiliconFlowError) as canceled:
        run_batches(
            batches,
            call_model=call,
            valid_refs={"stage_progress", "module:0", "module:1"},
            checkpoints=MemoryCheckpoints(),
            config=config,
            cancel_event=lambda: True,
        )
    assert "取消" in str(canceled.value)

    with pytest.raises(SiliconFlowError) as limited:
        run_batches(
            batches,
            call_model=call,
            valid_refs={"stage_progress", "module:0", "module:1"},
            checkpoints=MemoryCheckpoints(),
            config=config,
        )
    assert "调用上限" in str(limited.value)
    assert calls == 1


def test_migration_adds_batch_checkpoint_table():
    connection = sqlite3.connect(":memory:")
    migrate_database(connection)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == LATEST_SCHEMA_VERSION
    table = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='report_analysis_batches'"
    ).fetchone()
    assert table is not None


def test_report_batched_analysis_saves_and_resumes_checkpoints(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    from app.database import open_database
    from app.report_analysis import _run_batched_analysis

    store = MemoryCheckpoints()
    monkeypatch.setattr("app.report_analysis.DatabaseCheckpoints", lambda *_args: store)

    with open_database():
        pass

    class FakeAdapter:
        max_calls = 40
        call_count = 0

        def generate_json(self, *, evidence_json, **_kwargs):
            self.call_count += 1
            return _output(json.loads(evidence_json))

    analysis_input = _analysis_input(7)
    refs = {"stage_progress"} | {f"module:{index}" for index in range(7)}
    adapter = FakeAdapter()
    first = _run_batched_analysis(
        report_id=123,
        analysis_input=analysis_input,
        valid_refs=refs,
        provider="deepseek",
        model="deepseek-flash",
        api_key="secret",
        adapter=adapter,
        config=BatchConfig(modules_per_batch=3),
    )
    assert len(first.risks) == 3
    assert adapter.call_count == 3
