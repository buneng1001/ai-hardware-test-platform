"""AI 辅助的自动化用例转换：模型读原始用例并判定“可自动化”还是“转人工”。"""

import hashlib
import json
import sqlite3
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.ai_batching import batch_config
from app.ai_config import save_request_logs, selected_snapshot_payload
from app.ai_invocation import AiInvocationCancelled, begin_invocation
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
from app.settings import configured_api_key, get_provider_adapter
from app.siliconflow import SiliconFlowError

router = APIRouter(tags=["automation test cases"])

PROMPT_VERSION = "automation-conversion-v3"
CONFIDENCE_VALUES = {"high", "medium", "low"}
BLOCKER_VALUES = {
    "result_not_assertable",
    "data_unavailable",
    "subjective",
    "physical_action",
    "none",
}

SYSTEM_PROMPT = """
你是硬件产品的测试用例评审助手。判断一条用例能否做成“自动化用例”，
必须同时满足下面四道硬门槛，缺一即判 manual：

【硬门槛】
1. 结果可量化：预期结果能写成程序断言（数值区间、布尔真假、字符串/正则匹配、计数、集合相等）。
   “看起来清晰”“手感正常”“声音清脆”“灯色好看”这类判断不满足。
2. 数据可获取：判定所需的数据能从已登记数据包（视频、IMU、日志、mcap 解析结果）或设备接口读到。
   如果判定需要读一个平台拿不到的量（例如人眼观察、暗室主观亮度感受），不满足。
3. 不依赖主观感受：外观、手感、听感、颜色观感、体验好坏都不满足。
4. 不依赖物理动作：需要人按按键、插卡/拔卡、遮挡镜头、摆放样机、切换真实设备状态的动作不满足。
   平台目前只能做数据驱动模拟，没有真机控制能力。

【判定方法】
- 先看“预期结果”能否写成断言；再确认判定信号（帧率、码率、分辨率、丢帧数、GOP 长度、
  亮度/色差统计、IMU 数值范围等）能否从数据里算出来。
- 输入里的 product_profile 是被测产品画像（实体按键、指示灯、摄像头、麦克风、提示音、接口等），
  用来判断用例是否依赖物理实体：依赖实体就可能是 manual，除非该实体状态能从数据中间接判定。
- 同时给出判断依据：expected_signal 说明用什么信号判定，data_source 说明数据从哪来，blocker 说明是哪条门槛没过。

【输出】只输出一个 JSON 对象，不要解释文字：
{"items":[{"source_case_id":数字,"decision":"automation"或"manual",
"reason":"一行简短中文原因",
"expected_signal":"用什么信号/指标判定，manual 可留空",
"data_source":"数据包中的视频/IMU/日志/mcap/接口，manual 可留空",
"blocker":"result_not_assertable|data_unavailable|subjective|physical_action|none",
"title":"自动化用例标题","input":"输入","steps":"操作步骤",
"expected_result":"必须引用原用例预期结果里的关键阈值或条件",
"confidence":"high|medium|low"}]}

要求：source_case_id 必须来自输入，不能新增或遗漏；manual 条目的 title/input/steps/expected_result 可以是空字符串；
blocker 必须是给定枚举之一；不要编造输入里没有的用例。"""


class AutomationCaseConversionAiCommand(BaseModel):
    provider: str | None = Field(default=None, max_length=40)
    model: str | None = Field(default=None, max_length=200)
    api_key: str = Field(default="", max_length=400)
    # 生成范围：missing=只处理还没生成过自动化的用例；all=全部重新判定；selected=只处理勾选的用例。
    mode: Literal["missing", "all", "selected"] = "missing"
    source_case_ids: list[int] = Field(default_factory=list)
    repeat_confirmed: bool = False
    overwrite_previous: bool = False


def _resolve_target(command: AutomationCaseConversionAiCommand, snapshot: dict[str, str]) -> tuple[str, str, str]:
    """正式调用使用启动时已验证的配置，禁止用请求参数替换服务商或模型。"""
    provider, model = snapshot["provider"], snapshot["model"]
    if command.provider and command.provider != provider:
        raise HTTPException(status_code=409, detail="转换服务商与当前正式 AI 配置不一致")
    if command.model and command.model != model:
        raise HTTPException(status_code=409, detail="转换模型与当前正式 AI 配置不一致")
    api_key = configured_api_key(provider)
    if not api_key and snapshot["key_source"] == "temporary":
        api_key = command.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="未配置可用的 AI 模型密钥")
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
            expected_signal=str(entry.get("expected_signal", "")).strip()[:300],
            expected_result=str(entry.get("expected_result", "")).strip()[:1000],
            data_source=str(entry.get("data_source", "")).strip()[:200],
            blocker=(
                str(entry.get("blocker", "")).strip()
                if str(entry.get("blocker", "")).strip() in BLOCKER_VALUES
                else "none"
            ),
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


@router.get("/api/product-versions/{version_id}/automation-test-case-conversions/ai/runs")
def list_ai_conversion_runs(version_id: int) -> dict[str, object]:
    """Visible decisions stay retrievable across page refreshes, including independent reruns."""
    with open_database() as connection:
        _ensure_version(connection, version_id)
        rows = connection.execute(
            """SELECT id, fingerprint, decisions_json, created_at FROM ai_conversion_runs
               WHERE product_version_id = ? AND is_visible = 1 ORDER BY id DESC LIMIT 40""",
            (version_id,),
        ).fetchall()
        return {
            "items": [
                {
                    "id": row["id"],
                    "fingerprint": row["fingerprint"],
                    "created_at": row["created_at"],
                    "decisions": json.loads(row["decisions_json"]),
                }
                for row in rows
            ]
        }


@router.post(
    "/api/product-versions/{version_id}/automation-test-case-conversions/ai",
    response_model=AutomationCaseAiConversionBatch,
    status_code=status.HTTP_201_CREATED,
)
def convert_source_cases_with_ai(
    version_id: int, command: AutomationCaseConversionAiCommand
) -> AutomationCaseAiConversionBatch:
    """让模型读取原始用例，判定哪些可自动化，只为 automation 决策生成候选。"""
    decisions: list[AutomationCaseAiDecision] = []
    created_count = 0
    updated_count = 0
    removed_count = 0
    with open_database() as connection:
        _ensure_version(connection, version_id)
        # 产品画像：按键/指示灯/摄像头等物理形态，作为判断能否自动化的依据。
        profile_row = connection.execute(
            """
            SELECT version.project_id, version.ai_context, project.product_profile
            FROM product_versions version
            JOIN projects project ON project.id = version.project_id
            WHERE version.id = ?
            """,
            (version_id,),
        ).fetchone()
        ai_context = str(profile_row["ai_context"] or "")
        project_id = int(profile_row["project_id"])
        product_profile = None
        if profile_row is not None and profile_row["product_profile"]:
            try:
                product_profile = json.loads(profile_row["product_profile"])
            except json.JSONDecodeError:
                product_profile = None
        selected_ids = list(dict.fromkeys(command.source_case_ids))
        # 兼容旧前端：带了勾选 id 却没指定范围时，按“只处理勾选”执行。
        mode = command.mode if command.mode != "missing" or not selected_ids else "selected"
        if mode == "selected":
            if not selected_ids:
                raise HTTPException(status_code=422, detail="选择了“仅勾选用例”，但没有勾选任何用例")
            placeholders = ",".join("?" for _ in selected_ids)
            source_cases = connection.execute(
                f"""
                SELECT source.* FROM source_test_cases source
                WHERE source.product_version_id = ? AND source.id IN ({placeholders})
                ORDER BY source.id
                """,
                (version_id, *selected_ids),
            ).fetchall()
        elif mode == "all":
            # 全部重新判定：已有自动化用例的也会重新判，判定为 manual 的会被移除。
            source_cases = connection.execute(
                """
                SELECT source.* FROM source_test_cases source
                WHERE source.product_version_id = ?
                ORDER BY source.id
                """,
                (version_id,),
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
        frozen_cases = [dict(row) for row in source_cases]
        selected_config = selected_snapshot_payload()
        fingerprint_input = {
            "config_fingerprint": selected_config.get("fingerprint"),
            "source_cases": [
                {key: value for key, value in row.items() if key not in {"ai_decision", "updated_at"}}
                for row in frozen_cases
            ],
            "product_profile": product_profile,
            "ai_context": ai_context,
            "mode": mode,
            "prompt_version": PROMPT_VERSION,
        }
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint_input, ensure_ascii=False, sort_keys=True, default=str).encode()
        ).hexdigest()
        lease = begin_invocation(
            operation_type="automation_conversion",
            project_id=project_id,
            resource_id=version_id,
            execution_mode="checkpointed_batch",
            input_fingerprint=fingerprint,
        )
        outcome = "failed"
        try:
            if lease.config_snapshot["fingerprint"] != selected_config.get("fingerprint"):
                raise HTTPException(status_code=409, detail="正式 AI 配置已变更，请重新发起转换")
            old_run = connection.execute(
                """SELECT id FROM ai_conversion_runs WHERE product_version_id = ?
                   AND fingerprint = ? AND status = 'completed' AND is_visible = 1
                   ORDER BY id DESC LIMIT 1""",
                (version_id, fingerprint),
            ).fetchone()
            is_repeat = old_run is not None
            if is_repeat and not command.repeat_confirmed:
                raise HTTPException(
                    status_code=409,
                    detail="当前输入内容及分析条件与上一次执行完全一致，重新执行可能得到相同或相似的结果。",
                )
            planned_batches: list[tuple[dict[int, dict], dict[int, AutomationCaseAiDecision], dict]] = []
            provider, model, api_key = _resolve_target(command, dict(lease.config_snapshot))
            adapter = get_provider_adapter(provider)
            adapter.max_calls = batch_config().call_limit
            case_batch_size = batch_config().cases_per_batch
            for batch_start in range(0, len(source_cases), case_batch_size):
                batch = source_cases[batch_start : batch_start + case_batch_size]
                rows_by_id = {int(row["id"]): dict(row) for row in batch}
                if lease.cancel_requested():
                    raise AiInvocationCancelled("转换已停止")
                evidence = {
                    "product_profile": product_profile,
                    "ai_context": ai_context,
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
                    if lease.cancel_requested():
                        raise AiInvocationCancelled("丢弃取消后的模型响应")
                    batch_decisions = _parse_decisions(payload, set(rows_by_id))
                    # T07 replacement cannot silently turn missing model items into manual decisions.
                    if is_repeat and set(batch_decisions) != set(rows_by_id):
                        raise HTTPException(status_code=422, detail="模型判定缺少用例，新结果不完整，原结果未覆盖")
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

                if is_repeat:
                    planned_batches.append((rows_by_id, batch_decisions, payload))
                    for source_id, source_case in rows_by_id.items():
                        decision = batch_decisions.get(source_id)
                        if decision is None:
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
                    continue

                connection.execute("BEGIN IMMEDIATE")
                lease.assert_can_commit(connection)
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
                lease.assert_can_commit(connection)
                _touch_project(connection, version_id)
                connection.commit()
            if lease.cancel_requested():
                raise AiInvocationCancelled("转换已停止")
            # Repeated inputs are staged across all model batches. Publish candidates
            # only after every batch succeeds, inside one SQLite transaction.
            connection.execute("BEGIN IMMEDIATE")
            lease.assert_can_commit(connection)
            if is_repeat and command.overwrite_previous:
                for rows_by_id, batch_decisions, payload in planned_batches:
                    for source_id, source_case in rows_by_id.items():
                        decision = batch_decisions.get(source_id)
                        if decision is None:
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
                        connection.execute(
                            "UPDATE source_test_cases SET ai_decision = ? WHERE id = ?",
                            (decision.decision, source_id),
                        )
                        existing = connection.execute(
                            """SELECT id FROM automation_test_cases
                               WHERE product_version_id = ? AND source_test_case_id = ?""",
                            (version_id, source_id),
                        ).fetchone()
                        raw_entry = _raw_entry(payload, source_id)
                        if decision.decision == "automation":
                            if existing is not None:
                                _update_candidate(connection, int(existing["id"]), source_case, raw_entry, decision)
                                updated_count += 1
                            else:
                                _save_candidate(connection, version_id, source_case, raw_entry, decision)
                                created_count += 1
                        elif existing is not None:
                            connection.execute("DELETE FROM automation_test_cases WHERE id = ?", (int(existing["id"]),))
                            removed_count += 1
                _touch_project(connection, version_id)
                connection.execute(
                    """UPDATE ai_conversion_runs SET is_visible = 0
                       WHERE product_version_id = ? AND fingerprint = ?
                         AND status = 'completed' AND is_visible = 1""",
                    (version_id, fingerprint),
                )
            connection.execute(
                """INSERT INTO ai_conversion_runs
                   (product_version_id, fingerprint, status, decisions_json, is_visible, created_at)
                   VALUES (?, ?, 'completed', ?, 1, ?)""",
                (
                    version_id,
                    fingerprint,
                    json.dumps([item.model_dump() for item in decisions], ensure_ascii=False),
                    _now(),
                ),
            )
            lease.assert_can_commit(connection)
            items = _list_cases(connection, version_id)
            connection.commit()
            automation_count = sum(1 for item in decisions if item.decision == "automation")
            outcome = "completed"
            return AutomationCaseAiConversionBatch(
                automation_count=automation_count,
                manual_count=len(decisions) - automation_count,
                created_count=created_count,
                updated_count=updated_count,
                removed_count=removed_count,
                decisions=decisions,
                items=items,
            )
        except AiInvocationCancelled as error:
            connection.rollback()
            outcome = "cancelled"
            raise HTTPException(status_code=409, detail="AI 转换已取消；已完成批次保留") from error
        except Exception:
            # A failed write must release its SQLite transaction before lease.finish.
            connection.rollback()
            raise
        finally:
            lease.finish(outcome)


def _raw_entry(payload: dict[str, object], source_case_id: int) -> dict[str, object]:
    """取模型原始条目，用于保留模型给出的标题、步骤等字段。"""
    items = payload.get("items")
    if not isinstance(items, list):
        return {}
    for entry in items:
        if isinstance(entry, dict) and entry.get("source_case_id") == source_case_id:
            return entry
    return {}
