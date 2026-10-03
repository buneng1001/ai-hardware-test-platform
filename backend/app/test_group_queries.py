import sqlite3

from app.test_group_models import (
    AssignedDataPackage,
    TestGroupAutomationCase,
    TestGroupDetail,
    TestGroupSourceCase,
    TestGroupSummary,
)


def get_group_row(connection: sqlite3.Connection, group_id: int) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM test_groups WHERE id = ?", (group_id,)).fetchone()
    if row is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="测试组不存在")
    return row


def test_group_summary(connection: sqlite3.Connection, row: sqlite3.Row) -> TestGroupSummary:
    counts = connection.execute(
        """
        SELECT
          (SELECT COUNT(*) FROM test_group_source_cases WHERE test_group_id = ?) AS source_count,
          (SELECT COUNT(*) FROM test_group_automation_cases WHERE test_group_id = ?) AS automation_count,
          (SELECT COUNT(*) FROM test_group_data_package_assignments WHERE test_group_id = ?) AS assignment_count
        """,
        (row["id"], row["id"], row["id"]),
    ).fetchone()
    values = dict(row)
    values["hidden"] = bool(row["hidden"])
    values.update(
        source_test_case_count=counts["source_count"],
        automation_test_case_count=counts["automation_count"],
        data_package_assignment_count=counts["assignment_count"],
    )
    return TestGroupSummary(**values)


def _software_version_warning(row: sqlite3.Row, product_version: str) -> list[str]:
    if row["source_software_version"] and row["source_software_version"] != product_version:
        return [
            f"来源用例软件版本为 {row['source_software_version']}，与当前产品版本 {product_version} 不一致，请确认。"
        ]
    return []


def test_group_detail(connection: sqlite3.Connection, group_id: int) -> TestGroupDetail:
    group = get_group_row(connection, group_id)
    summary = test_group_summary(connection, group)
    product_version = connection.execute(
        "SELECT version FROM product_versions WHERE id = ?", (group["product_version_id"],)
    ).fetchone()["version"]
    source_rows = connection.execute(
        """
        SELECT source.id, source.case_number, source.title, source.test_type, source.software_version, item.position
        FROM test_group_source_cases item JOIN source_test_cases source ON source.id = item.source_test_case_id
        WHERE item.test_group_id = ? ORDER BY item.position
        """,
        (group_id,),
    ).fetchall()
    automation_rows = connection.execute(
        """
        SELECT automation.id, automation.case_number, source.case_number AS source_case_number, automation.title,
               automation.validation_status, source.software_version AS source_software_version, item.position
        FROM test_group_automation_cases item
        JOIN automation_test_cases automation ON automation.id = item.automation_test_case_id
        JOIN source_test_cases source ON source.id = automation.source_test_case_id
        WHERE item.test_group_id = ? ORDER BY item.position
        """,
        (group_id,),
    ).fetchall()
    automation_cases = []
    for item in automation_rows:
        package_rows = connection.execute(
            """
            SELECT package.*, EXISTS(
                SELECT 1 FROM data_packages newer
                WHERE newer.source_task_id = package.source_task_id
                  AND (
                    newer.generated_at > package.generated_at
                    OR (newer.generated_at = package.generated_at AND newer.id > package.id)
                  )
            ) AS has_newer_source_result,
            (SELECT source_run_id FROM data_packages newer WHERE newer.source_task_id = package.source_task_id
                ORDER BY newer.generated_at DESC, newer.id DESC LIMIT 1) AS recommended_source_run_id
            FROM test_group_data_package_assignments assignment
            JOIN data_packages package ON package.id = assignment.data_package_id
            WHERE assignment.test_group_id = ? AND assignment.automation_test_case_id = ?
            ORDER BY package.id
            """,
            (group_id, item["id"]),
        ).fetchall()
        packages = []
        for package_row in package_rows:
            warnings = _software_version_warning(item, product_version)
            if package_row["has_newer_source_result"]:
                warnings.append("数据包来源任务已有更新结果；当前仍保留已选择的数据包，未自动替换。")
            packages.append(
                AssignedDataPackage(
                    id=package_row["id"],
                    package_number=f"DP-{package_row['id']:06d}",
                    validation_status=package_row["validation_status"],
                    has_newer_source_result=bool(package_row["has_newer_source_result"]),
                    recommended_source_run_id=package_row["recommended_source_run_id"]
                    if package_row["has_newer_source_result"]
                    else None,
                    warnings=warnings,
                )
            )
        automation_cases.append(TestGroupAutomationCase(**dict(item), data_packages=packages))
    return TestGroupDetail(
        **summary.model_dump(),
        source_test_cases=[TestGroupSourceCase(**dict(item)) for item in source_rows],
        automation_test_cases=automation_cases,
    )
