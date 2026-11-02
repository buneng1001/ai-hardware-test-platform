"""AI 辅助的自动化用例转换：模型读原始用例并判定“可自动化”还是“转人工”。"""

import json
import sqlite3

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.ai_batching import batch_config
from app.ai_config import save_request_logs
from app.automation_case_history import record_automation_case_history
from app.automation_test_case_models import (
    AutomationCaseAiConversionBatch,
    AutomationCaseAiDecision,
)
from app.automation_test_cases import (
    _assign_case_number_and_get,
    _ensure_version,
    _list_cases,
    _now,
    _touch_project,
)
from app.database import open_database
from app.settings import configured_api_key, current_settings, get_provider_adapter
from app.siliconflow import SiliconFlowError

router = APIRouter(tags=["automation test cases"])

PROMPT_VERSION = "automation-conversion-v2"
CONFIDENCE_VALUES = {"high", "medium", "low"}

SYSTEM_PROMPT = """你是硬件产品的测试用例评审助手。
输入是一批原始测试用例。请逐条判断它能否做成自动化用例：
- automation：输入和预期结果可以被程序确定性校验，适合用数据驱动模拟执行。
- manual：依赖人工观察、外观手感、主观判断或真实设备操作，只能人工测试。
输入中的 product_profile 是被测产品画像（实体按键、指示灯、摄像头、麦克风、提示音、接口等），
请结合它判断这条用例依赖的是“物理观察/人工操作”还是“可程序校验的数据”。
只输出一个 JSON 对象，不要输出解释文字：
{"items":[{"source_case_id":数字,"decision":"automation"或"manual",
"reason":"一行简短中文原因","title":"自动化用例标题","input":"输入",
"steps":"操作步骤","expected_result":"预期结果","confidence":"high|medium|low"}]}
要求：source_case_id 必须来自输入，不能新增或遗漏；manual 条目的 title/input/steps/expected_result 可以是空字符串；
不要编造输入里没有的用例。"""


class AutomationCaseConversionAiCommand(BaseModel):
    provider: str | None = Field(default=None, max_length=40)
    model: str | None = Field(default=None, max_length=200)
    api_key: str = Field(default="", max_length=400)
    # 用户勾选的原始用例；不传时只处理尚未判定的用例。
    source_case_ids: list[int] = Field(default_factory=list)


def _resolve_target(command: AutomationCaseConversionAiCommand) -> tuple[str, str, str]:
    """请求里带了临时密钥就用请求参数，否则回落到后端已保存的 AI 配置。"""
    settings = current_settings()
    provider = (command.provider or settings.provider).strip()
    model = (command.model or settings.model).strip()
    api_key = command.api_key.strip() or configured_api_key(provider)
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未配置可用的 AI 模型：请先在首页配置并保存 AI 配置，或填写临时 API Key。",
        )
    return provider, model, api_key


def _parse_decisions(payload: dict[str, object], known_ids: set[int]) -> dict[int, AutomationCaseAiDecision]:
    """把模型输出转换成按原始用例 id 索引的判定；无法解析的条目直接忽略。"""
    items = payload.get("items")
    if not isinstance(items, list):
        raise ValueError("模型输出缺少 items 数组")
    decisions: dict[int, AutomationCaseAiDecision] = {}
    for entry in items:
        if not isinstance(entry, dict):
            continue
        source_case_id = entry.get("source_case_id")
        decision = entry.get("decision")
        if not isinstance(source_case_id, int) or source_case_id not in known_ids:
            continue
        if decision not in {"automation", "manual"}:
            continue
        confidence = entry.get("confidence")
        decisions[source_case_id] = AutomationCaseAiDecision(
            source_case_id=source_case_id,
            case_number=str(entry.get("case_number", "")),
            title=str(entry.get("title", "")),
            decision=decision,
            reason=str(entry.get("reason", "")).strip()[:500] or "模型未给出原因",
            confidence=confidence if confidence in CONFIDENCE_VALUES else "medium",
        )
    return decisions


def _save_candidate(
    connection: sqlite3.Connection,
    version_id: int,
    source_case: dict[str, object],
    entry: dict[str, object],
    decision: AutomationCaseAiDecision,
) -> None:
    timestamp = _now()
    cursor = connection.execute(
        """
        INSERT INTO automation_test_cases
            (product_version_id, source_test_case_id, conversion_status, confidence, review_note,
             title, input, steps, expected_result, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            version_id,
            source_case["id"],
            "candidate",
            # 领域模型只接受 low：AI 候选同样需要人工审核，模型自评置信度写入备注。
            "low",
            f"AI 判定可自动化（模型置信度 {decision.confidence}）：{decision.reason}",
            str(entry.get("title") or source_case.get("title") or ""),
            str(entry.get("input") or source_case.get("input") or ""),
            str(entry.get("steps") or source_case.get("steps") or ""),
            str(entry.get("expected_result") or ""),
            timestamp,
            timestamp,
        ),
    )
    case_id = cursor.lastrowid
    if case_id is None:
        raise HTTPException(status_code=500, detail="自动化用例保存失败")
    saved = _assign_case_number_and_get(connection, version_id, case_id)
    record_automation_case_history(connection, saved, "initial_conversion", source=source_case)


def _update_candidate(
    connection: sqlite3.Connection,
    case_id: int,
    source_case: dict[str, object],
    entry: dict[str, object],
    decision: AutomationCaseAiDecision,
) -> None:
    """重新判定为自动化时就地更新已有候选，保持编号和测试组关联不变。"""
    connection.execute(
        """
        UPDATE automation_test_cases
        SET conversion_status = ?, confidence = ?, review_note = ?, title = ?, input = ?,
            steps = ?, expected_result = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            "candidate",
            "low",
            f"AI 判定可自动化（模型置信度 {decision.confidence}）：{decision.reason}",
            str(entry.get("title") or source_case.get("title") or ""),
            str(entry.get("input") or source_case.get("input") or ""),
            str(entry.get("steps") or source_case.get("steps") or ""),
            str(entry.get("expected_result") or ""),
            _now(),
            case_id,
        ),
    )


@router.post(
    "/api/product-versions/{version_id}/automation-test-case-conversions/ai",
    response_model=AutomationCaseAiConversionBatch,
    status_code=status.HTTP_201_CREATED,
)
def convert_source_cases_with_ai(
    version_id: int, command: AutomationCaseConversionAiCommand
) -> AutomationCaseAiConversionBatch:
    """让模型读取原始用例，判定哪些可自动化，只为 automation 决策生成候选。"""
    provider, model, api_key = _resolve_target(command)
    adapter = get_provider_adapter(provider)
    adapter.max_calls = batch_config().call_limit

    decisions: list[AutomationCaseAiDecision] = []
    created_count = 0
    updated_count = 0
    removed_count = 0
    with open_database() as connection:
        _ensure_version(connection, version_id)
        # 产品画像：按键/指示灯/摄像头等物理形态，作为判断能否自动化的依据。
        profile_row = connection.execute(
            """
            SELECT project.product_profile
            FROM product_versions version
            JOIN projects project ON project.id = version.project_id
            WHERE version.id = ?
            """,
            (version_id,),
        ).fetchone()
        product_profile = None
        if profile_row is not None and profile_row["product_profile"]:
            try:
                product_profile = json.loads(profile_row["product_profile"])
            except json.JSONDecodeError:
                product_profile = None
        selected_ids = list(dict.fromkeys(command.source_case_ids))
        if selected_ids:
            # 用户勾选后点“AI 生成”，就按勾选范围重新判定，不再跳过已有候选的用例。
            placeholders = ",".join("?" for _ in selected_ids)
            source_cases = connection.execute(
                f"""
                SELECT source.* FROM source_test_cases source
                WHERE source.product_version_id = ? AND source.id IN ({placeholders})
                ORDER BY source.id
                """,
                (version_id, *selected_ids),
            ).fetchall()
        else:
            source_cases = connection.execute(
                """
                SELECT source.* FROM source_test_cases source
                LEFT JOIN automation_test_cases automation
                    ON automation.source_test_case_id = source.id
                WHERE source.product_version_id = ? AND automation.id IS NULL AND source.ai_decision = ''
                ORDER BY source.id
                """,
                (version_id,),
            ).fetchall()
        case_batch_size = batch_config().cases_per_batch
        for batch_start in range(0, len(source_cases), case_batch_size):
            batch = source_cases[batch_start : batch_start + case_batch_size]
            rows_by_id = {int(row["id"]): dict(row) for row in batch}
            evidence = {
                "product_profile": product_profile,
                "cases": [
                    {
                        "source_case_id": int(row["id"]),
                        "case_number": row["case_number"],
                        "title": row["title"],
                        "module": row["module"],
                        "priority": row["priority"],
                        "test_type": row["test_type"],
                        "input": row["input"],
                        "steps": row["steps"],
                        "expected_result": row["expected_result"],
                    }
                    for row in batch
                ],
            }
            try:
                payload = adapter.generate_json(
                    api_key=api_key,
                    model=model,
                    evidence_json=json.dumps(evidence, ensure_ascii=False),
                    system_prompt=SYSTEM_PROMPT,
                    prompt_version=PROMPT_VERSION,
                    stage="automation_conversion",
                )
                batch_decisions = _parse_decisions(payload, set(rows_by_id))
            except SiliconFlowError as error:
                save_request_logs(getattr(adapter, "request_logs", []))
                stage = getattr(error, "stage", "") or "unknown"
                kind = getattr(error, "kind", "") or "unknown"
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"AI 转换失败（阶段 {stage}／{kind}）：{error}",
                ) from error
            except ValueError as error:
                save_request_logs(getattr(adapter, "request_logs", []))
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"AI 输出无法解析：{error}",
                ) from error

            for source_id, source_case in rows_by_id.items():
                decision = batch_decisions.get(source_id)
                if decision is None:
                    # 模型漏判时按人工处理，避免把没有依据的用例直接变成自动化用例。
                    decision = AutomationCaseAiDecision(
                        source_case_id=source_id,
                        case_number=str(source_case["case_number"]),
                        title=str(source_case["title"]),
                        decision="manual",
                        reason="模型未给出判定，按人工用例处理",
                        confidence="low",
                    )
                elif decision.case_number == "":
                    decision = decision.model_copy(update={"case_number": str(source_case["case_number"])})
                decisions.append(decision)
                connection.execute(
                    "UPDATE source_test_cases SET ai_decision = ? WHERE id = ?",
                    (decision.decision, source_id),
                )
                existing = connection.execute(
                    """
                    SELECT id FROM automation_test_cases
                    WHERE product_version_id = ? AND source_test_case_id = ?
                    """,
                    (version_id, source_id),
                ).fetchone()
                raw_entry = _raw_entry(payload, source_id)
                if decision.decision == "automation":
                    if existing is not None:
                        # 已经有候选（例如之前跑过规则转换）就地更新，避免重复生成。
                        _update_candidate(connection, int(existing["id"]), source_case, raw_entry, decision)
                        updated_count += 1
                    else:
                        _save_candidate(connection, version_id, source_case, raw_entry, decision)
                        created_count += 1
                elif existing is not None:
                    # 判为人工的用例不再保留自动化候选，回到原始用例表按人工测试。
                    connection.execute("DELETE FROM automation_test_cases WHERE id = ?", (int(existing["id"]),))
                    removed_count += 1
            # 每批写完立刻提交，避免模型调用期间长时间占着写事务，
            # 否则用户同时勾选用例会直接报 database is locked。
            connection.commit()
        if created_count or updated_count or removed_count:
            _touch_project(connection, version_id)
        items = _list_cases(connection, version_id)

    automation_count = sum(1 for item in decisions if item.decision == "automation")
    return AutomationCaseAiConversionBatch(
        automation_count=automation_count,
        manual_count=len(decisions) - automation_count,
        created_count=created_count,
        updated_count=updated_count,
        removed_count=removed_count,
        decisions=decisions,
        items=items,
    )


def _raw_entry(payload: dict[str, object], source_case_id: int) -> dict[str, object]:
    """取模型原始条目，用于保留模型给出的标题、步骤等字段。"""
    items = payload.get("items")
    if not isinstance(items, list):
        return {}
    for entry in items:
        if isinstance(entry, dict) and entry.get("source_case_id") == source_case_id:
            return entry
    return {}
