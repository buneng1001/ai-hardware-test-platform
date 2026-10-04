"""数据驱动模拟的准备检查、不可变快照与确定性执行记录。"""

import json
import sqlite3
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status

from app.automation_execution_models import (
    AutomationExecutionCaseResult,
    AutomationExecutionPage,
    AutomationExecutionPreparation,
    AutomationExecutionRecord,
    AutomationExecutionSummary,
    PreparationCheck,
)
from app.database import open_database
from app.test_group_queries import get_group_row

router = APIRouter(tags=["automation executions"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _automation_cases(connection: sqlite3.Connection, group_id: int) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT item.position, automation.*, source.case_number AS source_case_number
        FROM test_group_automation_cases item
        JOIN automation_test_cases automation ON automation.id = item.automation_test_case_id
        JOIN source_test_cases source ON source.id = automation.source_test_case_id
        WHERE item.test_group_id = ? ORDER BY item.position
        """,
        (group_id,),
    ).fetchall()


def _packages_for_case(
    connection: sqlite3.Connection, group_id: int, automation_test_case_id: int
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT package.*
        FROM test_group_data_package_assignments assignment
        JOIN data_packages package ON package.id = assignment.data_package_id
        WHERE assignment.test_group_id = ? AND assignment.automation_test_case_id = ?
        ORDER BY package.id
        """,
        (group_id, automation_test_case_id),
    ).fetchall()


def _package_has_expected_format(package: sqlite3.Row) -> bool:
    try:
        files = json.loads(package["files"])
        integrity = json.loads(package["integrity"])
    except json.JSONDecodeError:
        return False
    kinds = {item.get("kind") for item in files if isinstance(item, dict)}
    return integrity.get("status") == "passed" and {"video", "imu"}.issubset(kinds)


def _preparation(connection: sqlite3.Connection, group_id: int) -> AutomationExecutionPreparation:
    get_group_row(connection, group_id)
    checks: list[PreparationCheck] = []
    cases = _automation_cases(connection, group_id)
    if not cases:
        checks.append(
            PreparationCheck(
                code="PREP_GROUP_EMPTY",
                object_type="test_group",
                object_id=group_id,
                actual="0 个自动化用例",
                expected="至少 1 个已校验自动化用例",
                suggestion="在测试组中加入已校验自动化用例。",
                action="edit_group",
            )
        )
    for case in cases:
        case_id = case["id"]
        if case["validation_status"] != "passed":
            checks.append(
                PreparationCheck(
                    code="PREP_CASE_NOT_VALIDATED",
                    object_type="automation_test_case",
                    object_id=case_id,
                    actual=f"校验状态：{case['validation_status']}",
                    expected="校验状态：passed",
                    suggestion="返回自动化用例表修复并重新校验该用例。",
                    action="edit_group",
                )
            )
        packages = _packages_for_case(connection, group_id, case_id)
        if not packages:
            checks.append(
                PreparationCheck(
                    code="PREP_CASE_DATA_MISSING",
                    object_type="automation_test_case",
                    object_id=case_id,
                    actual="未关联数据包",
                    expected="至少关联 1 个已校验的数据包",
                    suggestion="为该自动化用例关联已校验数据包。",
                    action="replace_data_packages",
                )
            )
        for package in packages:
            if package["validation_status"] != "passed" or not _package_has_expected_format(package):
                checks.append(
                    PreparationCheck(
                        code="PREP_DATA_PACKAGE_INVALID",
                        object_type="data_package",
                        object_id=package["id"],
                        actual=f"校验状态：{package['validation_status']}；格式不满足视频与 IMU 完整性要求",
                        expected="已校验通过，且包含视频、IMU 与完整性结果",
                        suggestion="替换为已校验通过的完整数据包后重新检查。",
                        action="replace_data_packages",
                    )
                )
    return AutomationExecutionPreparation(test_group_id=group_id, passed=not checks, checks=checks)


def _package_snapshot(package: sqlite3.Row) -> dict[str, object]:
    return {
        "id": package["id"],
        "package_number": f"DP-{package['id']:06d}",
        "source_run_id": package["source_run_id"],
        "data_kind": package["data_kind"],
        "fault_type": package["fault_type"],
        "version_fingerprint": package["version_fingerprint"],
        "validation_status": package["validation_status"],
        "validation_message": package["validation_message"],
        "files": json.loads(package["files"]),
        "integrity": json.loads(package["integrity"]),
    }


def _deterministic_check_summary(connection: sqlite3.Connection, package: sqlite3.Row) -> dict[str, object]:
    row = connection.execute("SELECT checks FROM runs WHERE id = ?", (package["source_run_id"],)).fetchone()
    checks = json.loads(row["checks"]) if row else []
    failed = [check["name"] for check in checks if check.get("status") == "failed"]
    return {"failed_checks": failed, "passed": not failed}


def _case_outcome(case: sqlite3.Row, packages: list[dict[str, object]]) -> tuple[str, str]:
    failed_checks = [name for package in packages for name in package["deterministic_checks"]["failed_checks"]]
    expected_fault = any(token in case["expected_result"] for token in ("故障", "异常", "失败", "告警", "检测到"))
    matches_expected = bool(failed_checks) if expected_fault else not failed_checks
    if matches_expected:
        return "passed", "确定性数据检查结果符合用例预期。"
    actual = "、".join(failed_checks) if failed_checks else "全部检查通过"
    return "failed", f"确定性检查实际结果：{actual}；未满足用例预期。"


def _case_snapshot(case: sqlite3.Row, packages: list[dict[str, object]]) -> dict[str, object]:
    return {
        "automation_test_case_id": case["id"],
        "case_number": case["case_number"],
        "source_case_number": case["source_case_number"],
        "title": case["title"],
        "input": case["input"],
        "steps": case["steps"],
        "expected_result": case["expected_result"],
        "validation_status": case["validation_status"],
        "data_packages": packages,
    }


def _record_from_row(connection: sqlite3.Connection, row: sqlite3.Row) -> AutomationExecutionRecord:
    results = connection.execute(
        """
        SELECT * FROM automation_execution_case_results
        WHERE automation_execution_id = ? ORDER BY position
        """,
        (row["id"],),
    ).fetchall()
    values = dict(row)
    values.update(
        group_snapshot=json.loads(row["group_snapshot"]),
        configuration_snapshot=json.loads(row["configuration_snapshot"]),
        summary=AutomationExecutionSummary(**json.loads(row["summary"])),
        case_results=[
            AutomationExecutionCaseResult(
                automation_test_case_id=item["automation_test_case_id"],
                case_number=json.loads(item["case_snapshot"])["case_number"],
                title=json.loads(item["case_snapshot"])["title"],
                position=item["position"],
                status=item["status"],
                message=item["message"],
                case_snapshot=json.loads(item["case_snapshot"]),
            )
            for item in results
        ],
    )
    return AutomationExecutionRecord(**values)


@router.post(
    "/api/test-groups/{group_id}/automation-execution-preparations",
    response_model=AutomationExecutionPreparation,
)
def prepare_automation_execution(group_id: int) -> AutomationExecutionPreparation:
    with open_database() as connection:
        return _preparation(connection, group_id)


@router.post(
    "/api/test-groups/{group_id}/automation-executions",
    response_model=AutomationExecutionRecord,
    status_code=status.HTTP_201_CREATED,
)
def start_automation_execution(
    group_id: int, terminal_status: Literal["completed", "cancelled", "interrupted"] = "completed"
) -> AutomationExecutionRecord:
    with open_database() as connection:
        group = get_group_row(connection, group_id)
        preparation = _preparation(connection, group_id)
        if not preparation.passed:
            raise HTTPException(
                status_code=409,
                detail={"message": "准备检查未通过，不能开始执行。", "checks": preparation.model_dump()["checks"]},
            )
        version = connection.execute(
            "SELECT version FROM product_versions WHERE id = ?", (group["product_version_id"],)
        ).fetchone()["version"]
        cases = _automation_cases(connection, group_id)
        started_at = _now()
        execution_number = connection.execute(
            "SELECT COALESCE(MAX(execution_number), 0) + 1 FROM automation_execution_records WHERE test_group_id = ?",
            (group_id,),
        ).fetchone()[0]
        group_snapshot = {
            "test_group_id": group_id,
            "name": group["name"],
            "description": group["description"],
            "product_version_id": group["product_version_id"],
            "product_version": version,
        }
        configuration_snapshot = {"execution_mode": "data_driven_simulation", "checker_version": "v0.2.0-rc.1"}
        case_payloads = []
        for case in cases:
            packages = []
            for item in _packages_for_case(connection, group_id, case["id"]):
                package = _package_snapshot(item)
                package["deterministic_checks"] = _deterministic_check_summary(connection, item)
                packages.append(package)
            case_payloads.append((case, packages))
        result_statuses = (
            [_case_outcome(case, packages)[0] for case, packages in case_payloads]
            if terminal_status == "completed"
            else ["not_executed"] * len(case_payloads)
        )
        summary = {key: result_statuses.count(key) for key in ("passed", "failed", "blocked", "not_executed")}
        record_id = connection.execute(
            """
            INSERT INTO automation_execution_records
                (test_group_id, product_version_id, execution_number, status, execution_mode, group_snapshot,
                 configuration_snapshot, summary, started_at, completed_at)
            VALUES (?, ?, ?, ?, 'data_driven_simulation', ?, ?, ?, ?, ?)
            """,
            (
                group_id,
                group["product_version_id"],
                execution_number,
                terminal_status,
                json.dumps(group_snapshot, ensure_ascii=False),
                json.dumps(configuration_snapshot, ensure_ascii=False),
                json.dumps(summary, ensure_ascii=False),
                started_at,
                _now(),
            ),
        ).lastrowid
        for case, packages in case_payloads:
            result_status, message = (
                _case_outcome(case, packages)
                if terminal_status == "completed"
                else ("not_executed", "执行在该用例开始前已取消或中断。")
            )
            case_snapshot = _case_snapshot(case, packages)
            connection.execute(
                """
                INSERT INTO automation_execution_case_results
                    (automation_execution_id, automation_test_case_id, position, status, message, case_snapshot)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    record_id,
                    case["id"],
                    case["position"],
                    result_status,
                    message,
                    json.dumps(case_snapshot, ensure_ascii=False),
                ),
            )
            connection.executemany(
                """
                INSERT INTO automation_execution_data_packages
                    (automation_execution_id, automation_test_case_id, data_package_id, package_snapshot)
                VALUES (?, ?, ?, ?)
                """,
                [(record_id, case["id"], item["id"], json.dumps(item, ensure_ascii=False)) for item in packages],
            )
        row = connection.execute("SELECT * FROM automation_execution_records WHERE id = ?", (record_id,)).fetchone()
        return _record_from_row(connection, row)


@router.post(
    "/api/test-groups/{group_id}/automation-executions/{terminal_status}",
    response_model=AutomationExecutionRecord,
    status_code=status.HTTP_201_CREATED,
)
def record_cancelled_or_interrupted_execution(
    group_id: int, terminal_status: Literal["cancelled", "interrupted"]
) -> AutomationExecutionRecord:
    return start_automation_execution(group_id, terminal_status)


@router.get("/api/test-groups/{group_id}/automation-executions", response_model=AutomationExecutionPage)
def list_automation_executions(group_id: int) -> AutomationExecutionPage:
    with open_database() as connection:
        get_group_row(connection, group_id)
        rows = connection.execute(
            "SELECT * FROM automation_execution_records WHERE test_group_id = ? ORDER BY id DESC", (group_id,)
        ).fetchall()
        return AutomationExecutionPage(items=[_record_from_row(connection, row) for row in rows])


@router.get("/api/automation-executions/{execution_id}", response_model=AutomationExecutionRecord)
def get_automation_execution(execution_id: int) -> AutomationExecutionRecord:
    with open_database() as connection:
        row = connection.execute("SELECT * FROM automation_execution_records WHERE id = ?", (execution_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="自动化执行记录不存在")
        return _record_from_row(connection, row)
