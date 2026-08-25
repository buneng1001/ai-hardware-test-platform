"""结构化诊断业务：Mock 与硅基流动均只消费限量证据，不进入测试关键路径。"""

import json
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, ValidationError

from app.database import open_database
from app.run_models import (
    DiagnosisCause,
    DiagnosisEvidenceItem,
    DiagnosisEvidencePackage,
    DiagnosisPhenomenon,
    DiagnosisRun,
    RunRecord,
    StructuredDiagnosis,
)
from app.runs import _get_run
from app.settings import configured_api_key, current_settings
from app.siliconflow import SiliconFlowAdapter, SiliconFlowError

router = APIRouter(prefix="/api/runs/{run_id}/diagnoses", tags=["diagnoses"])

MAX_EVIDENCE_BYTES = 32 * 1024
MAX_EVIDENCE_TOKENS = 4_000


class DiagnosisRequest(BaseModel):
    mode: str = "mock"
    model: str | None = Field(default=None, min_length=1, max_length=200)
    api_key: str = ""


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _candidate(kind: str, source: str, content: object) -> tuple[str, str, str]:
    return kind, source, _json(content) if not isinstance(content, str) else content


def build_evidence_package(run: RunRecord) -> DiagnosisEvidencePackage:
    """按固定顺序生成稳定引用，并在字节数和 Token 估算达到上限时停止。"""
    candidates: list[tuple[str, str, str]] = [
        _candidate("configuration", "run.configuration_snapshot", run.configuration_snapshot.model_dump(mode="json")),
        _candidate(
            "threshold",
            "run.evaluation_result",
            run.evaluation_result.model_dump(mode="json") if run.evaluation_result else "未生成判定结果",
        ),
    ]
    failed_checks = [check for check in run.checks if check.status == "failed"]
    checks = failed_checks or run.checks[:1]
    for check in checks:
        candidates.append(_candidate("failed_check", f"check:{check.name}", check.model_dump(mode="json")))
        for index, window in enumerate(check.anomaly_windows):
            candidates.append(_candidate("anomaly_window", f"check:{check.name}:window:{index}", window))
    for check in run.checks:
        if check.category == "resource":
            candidates.append(_candidate("resource_metric", f"check:{check.name}:metrics", check.metrics))
        if check.category == "log":
            candidates.append(_candidate("device_log", f"check:{check.name}:window", check.anomaly_windows))
        if check.category == "imu":
            candidates.append(_candidate("imu_summary", f"check:{check.name}:metrics", check.metrics))
    candidates.append(
        _candidate(
            "keyframe",
            "video:keyframe-summary",
            "本 Ticket 仅保存视频产物引用，未生成可供 Mock 分析的画面关键帧。",
        )
    )
    for result in run.manual_check_results:
        candidates.append(_candidate("manual_result", f"manual:{result.id}", result.model_dump(mode="json")))

    items: list[DiagnosisEvidenceItem] = []
    total_bytes = 0
    total_tokens = 0
    truncated = False
    for index, (kind, source, content) in enumerate(candidates, start=1):
        size_bytes = len(content.encode("utf-8"))
        estimated_tokens = max(1, (size_bytes + 3) // 4)
        if (
            total_bytes + size_bytes > MAX_EVIDENCE_BYTES
            or total_tokens + estimated_tokens > MAX_EVIDENCE_TOKENS
        ):
            truncated = True
            break
        items.append(
            DiagnosisEvidenceItem(
                ref=f"E{index:03d}",
                kind=kind,
                source=source,
                content=content,
                size_bytes=size_bytes,
                estimated_tokens=estimated_tokens,
            )
        )
        total_bytes += size_bytes
        total_tokens += estimated_tokens
    return DiagnosisEvidencePackage(
        items=items,
        total_bytes=total_bytes,
        estimated_tokens=total_tokens,
        max_bytes=MAX_EVIDENCE_BYTES,
        max_tokens=MAX_EVIDENCE_TOKENS,
        truncated=truncated,
    )


def _refs_for(package: DiagnosisEvidencePackage, predicate) -> list[str]:
    return [item.ref for item in package.items if predicate(item)]


def build_mock_diagnosis(run: RunRecord, package: DiagnosisEvidencePackage) -> StructuredDiagnosis:
    failed = [check for check in run.checks if check.status == "failed"]
    failed_refs = _refs_for(package, lambda item: item.kind == "failed_check")
    phenomenon_refs = failed_refs or [item.ref for item in package.items[:1]]
    phenomena = [
        DiagnosisPhenomenon(
            description=(
                "；".join(check.message for check in failed)
                if failed
                else "本次运行未检测到失败的确定性检查。"
            ),
            evidence_refs=phenomenon_refs,
        )
    ]
    cause = DiagnosisCause(
        cause=(
            f"与确定性检查 {', '.join(check.name for check in failed)} 相关的采集质量异常"
            if failed
            else "暂无证据支持的异常根因"
        ),
        evidence_refs=failed_refs,
        confidence="medium" if failed else "low",
        is_speculation=not bool(failed_refs),
    )
    return StructuredDiagnosis(
        diagnosis_status="completed",
        phenomena=phenomena,
        possible_causes=[cause],
        impact_scope=["当前运行记录的对应采集窗口"],
        retest_recommendations=["保持相同随机种子复测，并比较确定性检查结果与引用证据。"],
        missing_evidence=["关键帧或视觉分析结果未生成，无法进行画面语义复核。"],
        uncertainties=["当前结果只表示证据相关性，不能确认采集质量异常的根因。"],
        limitations=["Mock 诊断不调用模型，不能证明根因；时间相关性不等于因果关系。"],
    )


def validate_evidence_refs(output: StructuredDiagnosis, package: DiagnosisEvidencePackage) -> StructuredDiagnosis:
    """拒绝越权引用，并强制无证据原因显式标记为推测。"""
    refs = {item.ref for item in package.items}
    all_refs = [
        *sum((item.evidence_refs for item in output.phenomena), []),
        *sum((item.evidence_refs for item in output.possible_causes), []),
    ]
    invalid = sorted(set(all_refs) - refs)
    if invalid:
        raise HTTPException(status_code=422, detail=f"诊断包含无效证据引用：{', '.join(invalid)}")
    unsupported = [
        cause.cause
        for cause in output.possible_causes
        if not cause.evidence_refs and not cause.is_speculation
    ]
    if unsupported:
        raise HTTPException(status_code=422, detail="无证据支持的诊断原因必须标记为推测")
    return output


def _diagnosis_from_row(row) -> DiagnosisRun:
    return DiagnosisRun(
        id=row["id"],
        run_id=row["run_id"],
        status=row["status"],
        model=row["model"],
        prompt_version=row["prompt_version"],
        is_mock=bool(row["is_mock"]),
        evidence_package=json.loads(row["evidence_package"]),
        output=json.loads(row["output"]) if row["output"] else None,
        error=row["error"],
        created_at=row["created_at"],
        completed_at=row["completed_at"],
    )


def list_diagnoses(run_id: int) -> list[DiagnosisRun]:
    with open_database() as connection:
        rows = connection.execute(
            "SELECT * FROM diagnosis_runs WHERE run_id = ? ORDER BY id", (run_id,)
        ).fetchall()
    return [_diagnosis_from_row(row) for row in rows]


def latest_diagnosis(run_id: int) -> DiagnosisRun | None:
    diagnoses = list_diagnoses(run_id)
    return diagnoses[-1] if diagnoses else None


def _save_diagnosis(
    run_id: int,
    package: DiagnosisEvidencePackage,
    *,
    model: str,
    prompt_version: str,
    is_mock: bool,
    output: StructuredDiagnosis | None,
    error: str | None,
) -> DiagnosisRun:
    created_at = datetime.now(UTC)
    diagnosis_status = "completed" if output else "failed"
    with open_database() as connection:
        cursor = connection.execute(
            """INSERT INTO diagnosis_runs
            (run_id, status, model, prompt_version, is_mock, evidence_package, output, created_at, completed_at, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id,
                diagnosis_status,
                model,
                prompt_version,
                int(is_mock),
                package.model_dump_json(),
                output.model_dump_json() if output else None,
                created_at.isoformat(),
                created_at.isoformat(),
                error,
            ),
        )
        if cursor.lastrowid is None:
            raise HTTPException(status_code=500, detail="诊断运行保存失败")
        row = connection.execute("SELECT * FROM diagnosis_runs WHERE id = ?", (cursor.lastrowid,)).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="诊断运行保存失败")
    return _diagnosis_from_row(row)


@router.post("", response_model=DiagnosisRun, status_code=status.HTTP_201_CREATED)
def create_diagnosis(run_id: int, request: DiagnosisRequest | None = None) -> DiagnosisRun:
    run = _get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    if run.status != "completed":
        raise HTTPException(status_code=409, detail="只有已完成运行才能生成诊断")
    package = build_evidence_package(run)
    request = request or DiagnosisRequest()
    if request.mode == "mock":
        output = validate_evidence_refs(build_mock_diagnosis(run, package), package)
        return _save_diagnosis(
            run_id,
            package,
            model="mock-diagnosis-v1",
            prompt_version="mock-v1",
            is_mock=True,
            output=output,
            error=None,
        )
    if request.mode != "siliconflow":
        raise HTTPException(status_code=422, detail="不支持的诊断模式")

    settings = current_settings()
    model = request.model or settings.model
    api_key = request.api_key or configured_api_key()
    try:
        raw_output = SiliconFlowAdapter().generate(
            api_key=api_key,
            model=model,
            evidence_json=package.model_dump_json(),
        )
        output = validate_evidence_refs(StructuredDiagnosis.model_validate(raw_output), package)
    except (SiliconFlowError, ValidationError, HTTPException) as error:
        message = error.detail if isinstance(error, HTTPException) else str(error)
        return _save_diagnosis(
            run_id,
            package,
            model=model,
            prompt_version="diagnosis-v1",
            is_mock=False,
            output=None,
            error=message,
        )
    return _save_diagnosis(
        run_id,
        package,
        model=model,
        prompt_version="diagnosis-v1",
        is_mock=False,
        output=output,
        error=None,
    )


@router.get("", response_model=list[DiagnosisRun])
def get_diagnoses(run_id: int) -> list[DiagnosisRun]:
    if _get_run(run_id) is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    return list_diagnoses(run_id)
