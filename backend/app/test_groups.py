import sqlite3
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.database import open_database
from app.test_group_models import (
    CaseIds,
    DataPackageAssignmentBulk,
    DataPackageIds,
    OrderedCaseIds,
    TestGroupCreate,
    TestGroupDeletionImpact,
    TestGroupDetail,
    TestGroupPage,
    TestGroupUpdate,
)
from app.test_group_queries import get_group_row as _group_row
from app.test_group_queries import test_group_detail as _detail
from app.test_group_queries import test_group_summary as _summary_from_row

router = APIRouter(tags=["test groups"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _ensure_version(connection: sqlite3.Connection, version_id: int) -> None:
    if connection.execute("SELECT 1 FROM product_versions WHERE id = ?", (version_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="产品版本不存在")


def _touch_project(connection: sqlite3.Connection, version_id: int) -> None:
    connection.execute(
        "UPDATE projects SET updated_at = ? WHERE id = (SELECT project_id FROM product_versions WHERE id = ?)",
        (_now(), version_id),
    )


def _validate_group_cases(
    connection: sqlite3.Connection,
    group: sqlite3.Row,
    case_ids: list[int],
    table: str,
    case_table: str,
    eligible_only: bool = False,
) -> None:
    ids = sorted(set(case_ids))
    if len(ids) != len(case_ids):
        raise HTTPException(status_code=422, detail="用例不能重复")
    placeholders = ",".join("?" for _ in ids)
    query = f"SELECT id FROM {case_table} WHERE product_version_id = ? AND id IN ({placeholders})"
    if eligible_only:
        query += " AND validation_status = 'passed'"
    found = connection.execute(query, (group["product_version_id"], *ids)).fetchall()
    if len(found) != len(ids):
        message = "自动化用例必须属于当前版本且已校验通过" if eligible_only else "用例必须属于当前产品版本"
        raise HTTPException(status_code=422, detail=message)


def _replace_order(connection: sqlite3.Connection, group_id: int, case_ids: list[int], table: str, column: str) -> None:
    existing = [
        row[column]
        for row in connection.execute(
            f"SELECT {column} FROM {table} WHERE test_group_id = ? ORDER BY position", (group_id,)
        ).fetchall()
    ]
    if sorted(existing) != sorted(case_ids) or len(set(case_ids)) != len(case_ids):
        raise HTTPException(status_code=422, detail="排序必须包含且仅包含当前测试组中的全部用例")
    for position, case_id in enumerate(case_ids, start=1):
        connection.execute(
            f"UPDATE {table} SET position = ? WHERE test_group_id = ? AND {column} = ?",
            (position, group_id, case_id),
        )


@router.get("/api/product-versions/{version_id}/test-groups", response_model=TestGroupPage)
def list_test_groups(
    version_id: int,
    search: str = "",
    sort: Literal["updated_desc", "name_asc", "name_desc"] = "updated_desc",
    hidden: bool | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> TestGroupPage:
    order = {
        "updated_desc": "updated_at DESC, id DESC",
        "name_asc": "name COLLATE NOCASE ASC, id",
        "name_desc": "name COLLATE NOCASE DESC, id",
    }[sort]
    where, parameters = ["product_version_id = ?"], [version_id]
    if search.strip():
        where.append("name LIKE ?")
        parameters.append(f"%{search.strip()}%")
    if hidden is not None:
        where.append("hidden = ?")
        parameters.append(int(hidden))
    clause = " AND ".join(where)
    with open_database() as connection:
        _ensure_version(connection, version_id)
        total = connection.execute(f"SELECT COUNT(*) FROM test_groups WHERE {clause}", parameters).fetchone()[0]
        rows = connection.execute(
            f"SELECT * FROM test_groups WHERE {clause} ORDER BY {order} LIMIT ? OFFSET ?",
            (*parameters, page_size, (page - 1) * page_size),
        ).fetchall()
        return TestGroupPage(
            items=[_summary_from_row(connection, row) for row in rows], page=page, page_size=page_size, total=total
        )


@router.post(
    "/api/product-versions/{version_id}/test-groups",
    response_model=TestGroupDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_test_group(version_id: int, command: TestGroupCreate) -> TestGroupDetail:
    with open_database() as connection:
        _ensure_version(connection, version_id)
        timestamp = _now()
        try:
            group_id = connection.execute(
                "INSERT INTO test_groups "
                "(product_version_id, name, description, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (version_id, command.name, command.description, timestamp, timestamp),
            ).lastrowid
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="当前产品版本已存在同名测试组") from error
        if command.include_selected_source_cases:
            selected = connection.execute(
                "SELECT source_test_case_id FROM source_test_case_selections "
                "WHERE product_version_id = ? ORDER BY selected_at, source_test_case_id",
                (version_id,),
            ).fetchall()
            connection.executemany(
                "INSERT INTO test_group_source_cases (test_group_id, source_test_case_id, position) VALUES (?, ?, ?)",
                [(group_id, item["source_test_case_id"], index) for index, item in enumerate(selected, start=1)],
            )
        _touch_project(connection, version_id)
        return _detail(connection, group_id)


@router.get("/api/test-groups/{group_id}", response_model=TestGroupDetail)
def get_test_group(group_id: int) -> TestGroupDetail:
    with open_database() as connection:
        return _detail(connection, group_id)


@router.patch("/api/test-groups/{group_id}", response_model=TestGroupDetail)
def update_test_group(group_id: int, command: TestGroupUpdate) -> TestGroupDetail:
    changes = command.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="至少提供一个需要修改的字段")
    with open_database() as connection:
        group = _group_row(connection, group_id)
        try:
            connection.execute(
                f"UPDATE test_groups SET {', '.join(f'{field} = ?' for field in changes)}, updated_at = ? WHERE id = ?",
                (*changes.values(), _now(), group_id),
            )
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="当前产品版本已存在同名测试组") from error
        _touch_project(connection, group["product_version_id"])
        return _detail(connection, group_id)


@router.post("/api/test-groups/{group_id}/hide", response_model=TestGroupDetail)
def hide_test_group(group_id: int) -> TestGroupDetail:
    return _set_hidden(group_id, True)


@router.post("/api/test-groups/{group_id}/restore", response_model=TestGroupDetail)
def restore_test_group(group_id: int) -> TestGroupDetail:
    return _set_hidden(group_id, False)


def _set_hidden(group_id: int, hidden: bool) -> TestGroupDetail:
    with open_database() as connection:
        group = _group_row(connection, group_id)
        connection.execute(
            "UPDATE test_groups SET hidden = ?, updated_at = ? WHERE id = ?", (int(hidden), _now(), group_id)
        )
        _touch_project(connection, group["product_version_id"])
        return _detail(connection, group_id)


@router.get("/api/test-groups/{group_id}/deletion-impact", response_model=TestGroupDeletionImpact)
def get_test_group_deletion_impact(group_id: int) -> TestGroupDeletionImpact:
    with open_database() as connection:
        group = _group_row(connection, group_id)
        counts = _summary_from_row(connection, group)
        manual_counts = connection.execute(
            """
            SELECT COUNT(DISTINCT batch.id) AS batches, COUNT(DISTINCT result.id) AS results,
                   COUNT(attachment.id) AS attachments
            FROM manual_test_result_batches batch
            LEFT JOIN manual_test_results result ON result.manual_test_result_batch_id = batch.id
            LEFT JOIN manual_test_result_attachments attachment ON attachment.manual_test_result_id = result.id
            WHERE batch.test_group_id = ?
            """,
            (group_id,),
        ).fetchone()
        return TestGroupDeletionImpact(
            test_group_id=group_id,
            name=group["name"],
            source_test_cases=counts.source_test_case_count,
            automation_test_cases=counts.automation_test_case_count,
            data_package_assignments=counts.data_package_assignment_count,
            manual_test_result_batches=manual_counts["batches"],
            manual_test_results=manual_counts["results"],
            manual_test_result_attachments=manual_counts["attachments"],
            message="删除会移除测试组范围、人工结果及其附件；不会删除平台级用例或数据包。",
        )


@router.delete("/api/test-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_test_group(group_id: int, confirm: bool = False) -> Response:
    if not confirm:
        raise HTTPException(status_code=400, detail="请先查看测试组影响范围并确认删除")
    with open_database() as connection:
        group = _group_row(connection, group_id)
        connection.execute("DELETE FROM test_groups WHERE id = ?", (group_id,))
        _touch_project(connection, group["product_version_id"])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _add_cases(
    group_id: int, command: CaseIds, table: str, column: str, case_table: str, eligible_only: bool = False
) -> TestGroupDetail:
    with open_database() as connection:
        group = _group_row(connection, group_id)
        _validate_group_cases(connection, group, command.case_ids, table, case_table, eligible_only)
        start = connection.execute(
            f"SELECT COALESCE(MAX(position), 0) FROM {table} WHERE test_group_id = ?", (group_id,)
        ).fetchone()[0]
        connection.executemany(
            f"INSERT OR IGNORE INTO {table} (test_group_id, {column}, position) VALUES (?, ?, ?)",
            [(group_id, case_id, start + index) for index, case_id in enumerate(command.case_ids, start=1)],
        )
        _touch_project(connection, group["product_version_id"])
        return _detail(connection, group_id)


def _remove_case(group_id: int, case_id: int, table: str, column: str) -> Response:
    with open_database() as connection:
        group = _group_row(connection, group_id)
        if (
            connection.execute(
                f"DELETE FROM {table} WHERE test_group_id = ? AND {column} = ?", (group_id, case_id)
            ).rowcount
            == 0
        ):
            raise HTTPException(status_code=404, detail="用例不在当前测试组中")
        _touch_project(connection, group["product_version_id"])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/test-groups/{group_id}/source-test-cases", response_model=TestGroupDetail)
def add_source_cases(group_id: int, command: CaseIds) -> TestGroupDetail:
    return _add_cases(group_id, command, "test_group_source_cases", "source_test_case_id", "source_test_cases")


@router.delete("/api/test-groups/{group_id}/source-test-cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_source_case(group_id: int, case_id: int) -> Response:
    return _remove_case(group_id, case_id, "test_group_source_cases", "source_test_case_id")


@router.put("/api/test-groups/{group_id}/source-test-cases/order", response_model=TestGroupDetail)
def order_source_cases(group_id: int, command: OrderedCaseIds) -> TestGroupDetail:
    with open_database() as connection:
        group = _group_row(connection, group_id)
        _replace_order(connection, group_id, command.case_ids, "test_group_source_cases", "source_test_case_id")
        _touch_project(connection, group["product_version_id"])
        return _detail(connection, group_id)


@router.post("/api/test-groups/{group_id}/automation-test-cases", response_model=TestGroupDetail)
def add_automation_cases(group_id: int, command: CaseIds) -> TestGroupDetail:
    return _add_cases(
        group_id, command, "test_group_automation_cases", "automation_test_case_id", "automation_test_cases", True
    )


@router.delete("/api/test-groups/{group_id}/automation-test-cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_automation_case(group_id: int, case_id: int) -> Response:
    return _remove_case(group_id, case_id, "test_group_automation_cases", "automation_test_case_id")


@router.put("/api/test-groups/{group_id}/automation-test-cases/order", response_model=TestGroupDetail)
def order_automation_cases(group_id: int, command: OrderedCaseIds) -> TestGroupDetail:
    with open_database() as connection:
        group = _group_row(connection, group_id)
        _replace_order(connection, group_id, command.case_ids, "test_group_automation_cases", "automation_test_case_id")
        _touch_project(connection, group["product_version_id"])
        return _detail(connection, group_id)


def _validate_assignments(
    connection: sqlite3.Connection, group_id: int, case_ids: list[int], package_ids: list[int]
) -> None:
    case_set = set(case_ids)
    in_group = (
        {
            row[0]
            for row in connection.execute(
                "SELECT automation_test_case_id FROM test_group_automation_cases "
                f"WHERE test_group_id = ? AND automation_test_case_id IN ({','.join('?' for _ in case_set)})",
                (group_id, *case_set),
            ).fetchall()
        }
        if case_set
        else set()
    )
    if in_group != case_set:
        raise HTTPException(status_code=422, detail="自动化用例必须已在当前测试组中")
    package_set = set(package_ids)
    if package_set:
        valid_packages = {
            row[0]
            for row in connection.execute(
                "SELECT id FROM data_packages WHERE validation_status = 'passed' "
                f"AND id IN ({','.join('?' for _ in package_set)})",
                tuple(package_set),
            ).fetchall()
        }
        if valid_packages != package_set:
            raise HTTPException(status_code=422, detail="只能关联已校验通过的数据包")


@router.post("/api/test-groups/{group_id}/data-package-assignments", response_model=TestGroupDetail)
def bulk_assign_data_package(group_id: int, command: DataPackageAssignmentBulk) -> TestGroupDetail:
    with open_database() as connection:
        group = _group_row(connection, group_id)
        _validate_assignments(connection, group_id, command.automation_test_case_ids, [command.data_package_id])
        connection.executemany(
            "INSERT OR IGNORE INTO test_group_data_package_assignments "
            "(test_group_id, automation_test_case_id, data_package_id) VALUES (?, ?, ?)",
            [(group_id, case_id, command.data_package_id) for case_id in command.automation_test_case_ids],
        )
        _touch_project(connection, group["product_version_id"])
        return _detail(connection, group_id)


@router.put("/api/test-groups/{group_id}/automation-test-cases/{case_id}/data-packages", response_model=TestGroupDetail)
def replace_case_data_packages(group_id: int, case_id: int, command: DataPackageIds) -> TestGroupDetail:
    if len(set(command.data_package_ids)) != len(command.data_package_ids):
        raise HTTPException(status_code=422, detail="数据包不能重复")
    with open_database() as connection:
        group = _group_row(connection, group_id)
        _validate_assignments(connection, group_id, [case_id], command.data_package_ids)
        connection.execute(
            "DELETE FROM test_group_data_package_assignments WHERE test_group_id = ? AND automation_test_case_id = ?",
            (group_id, case_id),
        )
        connection.executemany(
            "INSERT INTO test_group_data_package_assignments "
            "(test_group_id, automation_test_case_id, data_package_id) VALUES (?, ?, ?)",
            [(group_id, case_id, package_id) for package_id in command.data_package_ids],
        )
        _touch_project(connection, group["product_version_id"])
        return _detail(connection, group_id)
