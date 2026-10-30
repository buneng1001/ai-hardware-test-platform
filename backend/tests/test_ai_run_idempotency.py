import sqlite3

from app import report_analysis as module
from app.ai_batching import run_fingerprint
from app.database import LATEST_SCHEMA_VERSION, migrate_database
from app.fact_report_models import ReportAnalysisItem, ReportAnalysisOutput, ReportStageRecommendation
from app.report_analysis import (
    _save,
    analysis_history,
    find_reusable_analysis,
    latest_analysis,
)


def _output() -> ReportAnalysisOutput:
    item = ReportAnalysisItem(content="建议", evidence_refs=["stage_progress"])
    return ReportAnalysisOutput(
        risks=[item],
        additional_verifications=[],
        regression_recommendations=[],
        stage_recommendation=ReportStageRecommendation(
            suggestion="暂缓",
            content="仅建议",
            evidence_refs=["stage_progress"],
        ),
    )


def test_fingerprint_is_stable_and_changes_with_input_or_model():
    config = {"provider": "deepseek", "model": "deepseek-flash", "key_source": "environment"}
    first = run_fingerprint({"modules": []}, config, "deepseek-flash", "report-analysis-v1")
    second = run_fingerprint({"modules": []}, config, "deepseek-flash", "report-analysis-v1")
    changed = run_fingerprint({"modules": [{"ref": "module:0"}]}, config, "deepseek-flash", "report-analysis-v1")
    other_model = run_fingerprint({"modules": []}, config, "deepseek-v4-pro", "report-analysis-v1")
    assert first == second
    assert first != changed
    assert first != other_model
    assert "api_key" not in config


def test_new_run_activates_and_keeps_history_separate(monkeypatch):
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    migrate_database(connection)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == LATEST_SCHEMA_VERSION
    monkeypatch.setattr(module, "selected_snapshot_payload", lambda: {})
    analysis_input = {"modules": []}

    first = _save(
        connection,
        1,
        analysis_input,
        provider="deepseek",
        model="deepseek-flash",
        is_mock=False,
        output=_output(),
        error=None,
    )
    assert first.run_id is not None
    assert first.fingerprint
    assert find_reusable_analysis(connection, 1, first.fingerprint) is not None

    failed = _save(
        connection,
        1,
        analysis_input,
        provider="deepseek",
        model="deepseek-flash",
        is_mock=False,
        output=None,
        error="模型请求超时",
        error_detail={"kind": "timeout", "action": "稍后重试"},
    )
    current = latest_analysis(connection, 1)
    assert current.run_id == failed.run_id
    assert current.status == "failed"
    # 失败运行不参与幂等复用，但同一指纹的成功结果仍可复用。
    reusable = find_reusable_analysis(connection, 1, failed.fingerprint or "")
    assert reusable is not None
    assert reusable["status"] == "completed"

    history = analysis_history(connection, 1)
    assert len(history) == 2
    assert sum(int(item["is_active"]) for item in history) == 1
    assert history[0]["is_active"] == 1
    # 上一次成功结果仍可按指纹找到，历史与当前视图分开。
    assert find_reusable_analysis(connection, 1, first.fingerprint or "") is not None
