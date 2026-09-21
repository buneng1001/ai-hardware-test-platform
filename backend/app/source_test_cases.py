import json
import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request, Response, status

from app.database import open_database
from app.source_test_case_models import (
    OPTIONAL_IMPORT_FIELDS,
    SOURCE_CASE_FIELDS,
    ImportDeletionImpact,
    SourceTestCase,
    SourceTestCaseImportCommand,
    SourceTestCaseImportRecord,
    SourceTestCaseList,
    SourceTestCaseSelectionCommand,
)
from app.source_test_case_parsing import infer_field_mapping, parse_source_case_file

router = APIRouter(tags=["source test cases"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _ensure_version(connection: sqlite3.Connection, version_id: int) -> None:
    if connection.execute("SELECT 1 FROM product_versions WHERE id = ?", (version_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="产品版本不存在")


def _record_from_row(row: sqlite3.Row) -> SourceTestCaseImportRecord:
    values = dict(row)
    values["field_mapping"] = json.loads(values["field_mapping"])
    values["import_options"] = json.loads(values["import_options"])
    return SourceTestCaseImportRecord(**values)


def _case_from_row(row: sqlite3.Row) -> SourceTestCase:
    values = dict(row)
    values["source_import_status"] = "import_deleted" if values.pop("source_import_deleted") else "active"
    values["selected"] = bool(values["selected"])
    return SourceTestCase(**values)


@router.post(
    "/api/product-versions/{version_id}/source-test-case-imports/preview",
    response_model=SourceTestCaseImportCommand,
)
async def preview_source_test_case_import(
    version_id: int, filename: str, request: Request
) -> SourceTestCaseImportCommand:
    content = await request.body()
    columns, rows = parse_source_case_file(filename, content)
    with open_database() as connection:
        _ensure_version(connection, version_id)
    if not rows:
        raise HTTPException(status_code=422, detail="导入文件不包含数据行")
    return SourceTestCaseImportCommand.model_construct(
        source_filename=filename.strip(), field_mapping=infer_field_mapping(columns), rows=rows
    )


@router.post(
    "/api/product-versions/{version_id}/source-test-case-imports",
    response_model=SourceTestCaseImportRecord,
    status_code=status.HTTP_201_CREATED,
)
def create_source_test_case_import(version_id: int, command: SourceTestCaseImportCommand) -> SourceTestCaseImportRecord:
    timestamp = _now()
    options = command.import_options.model_dump()
    source_columns = ",".join(SOURCE_CASE_FIELDS)
    source_placeholders = ",".join("?" for _ in SOURCE_CASE_FIELDS)
    with open_database() as connection:
        _ensure_version(connection, version_id)
        cursor = connection.execute(
            """
            INSERT INTO source_test_case_imports
                (product_version_id, source_filename, field_mapping, import_options, imported_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                version_id,
                command.source_filename,
                json.dumps(command.field_mapping, ensure_ascii=False),
                json.dumps(options, ensure_ascii=False),
                timestamp,
            ),
        )
        import_record_id = cursor.lastrowid
        if import_record_id is None:
            raise HTTPException(status_code=500, detail="导入记录保存失败")
        for row in command.rows:
            values = _mapped_case_values(row, command.field_mapping, options)
            connection.execute(
                f"""
                INSERT INTO source_test_cases
                    (product_version_id, import_record_id, {source_columns}, source_import_deleted, created_at)
                VALUES (?, ?, {source_placeholders}, 0, ?)
                """,
                (version_id, import_record_id, *(values[field] for field in SOURCE_CASE_FIELDS), timestamp),
            )
        connection.execute(
            "UPDATE projects SET updated_at = ? WHERE id = (SELECT project_id FROM product_versions WHERE id = ?)",
            (timestamp, version_id),
        )
        saved = connection.execute(
            "SELECT * FROM source_test_case_imports WHERE id = ?", (import_record_id,)
        ).fetchone()
    if saved is None:
        raise HTTPException(status_code=500, detail="导入记录保存失败")
    return _record_from_row(saved)


@router.get(
    "/api/product-versions/{version_id}/source-test-case-imports", response_model=list[SourceTestCaseImportRecord]
)
def list_source_test_case_imports(version_id: int) -> list[SourceTestCaseImportRecord]:
    with open_database() as connection:
        _ensure_version(connection, version_id)
        rows = connection.execute(
            "SELECT * FROM source_test_case_imports WHERE product_version_id = ? ORDER BY imported_at DESC, id DESC",
            (version_id,),
        ).fetchall()
    return [_record_from_row(row) for row in rows]


@router.get("/api/product-versions/{version_id}/source-test-cases", response_model=SourceTestCaseList)
def list_source_test_cases(
    version_id: int,
    module: str = Query(default="", max_length=120),
    test_item: str = Query(default="", max_length=120),
    priority: str = Query(default="", max_length=80),
    software_version: str = Query(default="", max_length=120),
) -> SourceTestCaseList:
    filters = {
        "module": module.strip(),
        "test_item": test_item.strip(),
        "priority": priority.strip(),
        "software_version": software_version.strip(),
    }
    clauses = ["c.product_version_id = ?"]
    parameters: list[object] = [version_id]
    for field, value in filters.items():
        if value:
            clauses.append(f"c.{field} = ?")
            parameters.append(value)
    source_case_columns = ",".join(f"c.{field}" for field in SOURCE_CASE_FIELDS)
    with open_database() as connection:
        _ensure_version(connection, version_id)
        rows = connection.execute(
            f"""
            SELECT c.id, c.import_record_id, c.source_import_deleted, {source_case_columns},
                   EXISTS(
                       SELECT 1 FROM source_test_case_selections selection
                       WHERE selection.product_version_id = c.product_version_id
                         AND selection.source_test_case_id = c.id
                   ) AS selected
            FROM source_test_cases c
            WHERE {" AND ".join(clauses)}
            ORDER BY c.id
            """,
            parameters,
        ).fetchall()
    return SourceTestCaseList(items=[_case_from_row(row) for row in rows])


@router.put(
    "/api/product-versions/{version_id}/source-test-case-selection",
    response_model=SourceTestCaseSelectionCommand,
)
def replace_source_test_case_selection(
    version_id: int, command: SourceTestCaseSelectionCommand
) -> SourceTestCaseSelectionCommand:
    selected_ids = sorted(set(command.source_test_case_ids))
    with open_database() as connection:
        _ensure_version(connection, version_id)
        if selected_ids:
            placeholders = ",".join("?" for _ in selected_ids)
            found = connection.execute(
                f"SELECT id FROM source_test_cases WHERE product_version_id = ? AND id IN ({placeholders})",
                (version_id, *selected_ids),
            ).fetchall()
            if len(found) != len(selected_ids):
                raise HTTPException(status_code=422, detail="勾选项必须属于当前产品版本")
        connection.execute("DELETE FROM source_test_case_selections WHERE product_version_id = ?", (version_id,))
        connection.executemany(
            """
            INSERT INTO source_test_case_selections
                (product_version_id, source_test_case_id, selected_at)
            VALUES (?, ?, ?)
            """,
            [(version_id, case_id, _now()) for case_id in selected_ids],
        )
    return SourceTestCaseSelectionCommand(source_test_case_ids=selected_ids)


@router.get("/api/source-test-case-imports/{import_id}/deletion-impact", response_model=ImportDeletionImpact)
def get_source_test_case_import_deletion_impact(import_id: int) -> ImportDeletionImpact:
    with open_database() as connection:
        import_record = connection.execute(
            "SELECT id FROM source_test_case_imports WHERE id = ?", (import_id,)
        ).fetchone()
        if import_record is None:
            raise HTTPException(status_code=404, detail="导入记录不存在")
        source_test_cases = connection.execute(
            "SELECT COUNT(*) FROM source_test_cases WHERE import_record_id = ?", (import_id,)
        ).fetchone()[0]
        automation_test_cases = _automation_case_count_for_import(connection, import_id)
    return ImportDeletionImpact(
        import_record_id=import_id,
        source_test_cases=source_test_cases,
        automation_test_cases=automation_test_cases,
        message="删除后原始用例保留，但其来源会标记为“导入记录已删除”；已有自动化用例不会被删除。",
    )


@router.delete("/api/source-test-case-imports/{import_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source_test_case_import(import_id: int, confirm: bool = False) -> Response:
    if not confirm:
        raise HTTPException(status_code=400, detail="请先查看影响范围并确认删除")
    with open_database() as connection:
        record = connection.execute(
            "SELECT product_version_id FROM source_test_case_imports WHERE id = ?", (import_id,)
        ).fetchone()
        if record is None:
            raise HTTPException(status_code=404, detail="导入记录不存在")
        connection.execute(
            "UPDATE source_test_cases SET source_import_deleted = 1 WHERE import_record_id = ?", (import_id,)
        )
        connection.execute("DELETE FROM source_test_case_imports WHERE id = ?", (import_id,))
        connection.execute(
            "UPDATE projects SET updated_at = ? WHERE id = (SELECT project_id FROM product_versions WHERE id = ?)",
            (_now(), record["product_version_id"]),
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _mapped_case_values(row: dict[str, str], mapping: dict[str, str], options: dict[str, bool]) -> dict[str, str]:
    values: dict[str, str] = {}
    for field in SOURCE_CASE_FIELDS:
        option = OPTIONAL_IMPORT_FIELDS.get(field)
        source_column = mapping.get(field, "")
        values[field] = "" if option and not options[option] else row.get(source_column, "").strip()
    return values


def _automation_case_count_for_import(connection: sqlite3.Connection, import_id: int) -> int:
    """兼容后续自动化用例表，避免关联资产出现后删除预览失实。"""
    table_exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'automation_test_cases'"
    ).fetchone()
    if table_exists is None:
        return 0
    columns = {row[1] for row in connection.execute("PRAGMA table_info(automation_test_cases)").fetchall()}
    if "source_test_case_id" in columns:
        return connection.execute(
            """
            SELECT COUNT(*)
            FROM automation_test_cases automation
            JOIN source_test_cases source ON source.id = automation.source_test_case_id
            WHERE source.import_record_id = ?
            """,
            (import_id,),
        ).fetchone()[0]
    if "source_import_record_id" in columns:
        return connection.execute(
            "SELECT COUNT(*) FROM automation_test_cases WHERE source_import_record_id = ?", (import_id,)
        ).fetchone()[0]
    return 0
