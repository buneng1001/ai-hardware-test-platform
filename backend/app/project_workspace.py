import sqlite3
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.database import open_database
from app.project_models import (
    ProductVersion,
    ProductVersionCreate,
    ProductVersionDeletionImpact,
    ProductVersionUpdate,
    ProjectCreate,
    ProjectDeletionImpact,
    ProjectDetail,
    ProjectSummary,
    ProjectTrend,
    VersionImpactItem,
)

router = APIRouter(tags=["project-workspace"])

ASSET_TABLES = {
    "source_test_cases": "source_test_cases",
    "automation_test_cases": "automation_test_cases",
    "data_packages": "data_packages",
    "test_groups": "test_groups",
    "automation_execution_records": "automation_execution_records",
    "manual_test_records": "manual_test_records",
    "online_reports": "online_reports",
}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _version_from_row(row: sqlite3.Row) -> ProductVersion:
    return ProductVersion(**dict(row))


def _get_project(connection: sqlite3.Connection, project_id: int) -> ProjectDetail:
    row = connection.execute(
        """
        SELECT p.*, COUNT(v.id) AS product_version_count
        FROM projects p
        LEFT JOIN product_versions v ON v.project_id = p.id
        WHERE p.id = ?
        GROUP BY p.id
        """,
        (project_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    versions = connection.execute(
        "SELECT * FROM product_versions WHERE project_id = ? ORDER BY created_at, id",
        (project_id,),
    ).fetchall()
    return ProjectDetail(**dict(row), product_versions=[_version_from_row(item) for item in versions])


def _get_version(connection: sqlite3.Connection, version_id: int) -> ProductVersion:
    row = connection.execute("SELECT * FROM product_versions WHERE id = ?", (version_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="产品版本不存在")
    return _version_from_row(row)


def _asset_counts(connection: sqlite3.Connection, version_ids: list[int]) -> dict[str, int]:
    counts = dict.fromkeys(ASSET_TABLES, 0)
    if not version_ids:
        return counts
    placeholders = ",".join("?" for _ in version_ids)
    existing_tables = {
        row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    }
    for response_name, table_name in ASSET_TABLES.items():
        if table_name not in existing_tables:
            continue
        columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()}
        if "product_version_id" in columns:
            counts[response_name] = connection.execute(
                f"SELECT COUNT(*) FROM {table_name} WHERE product_version_id IN ({placeholders})",
                version_ids,
            ).fetchone()[0]
    return counts


@router.post("/api/projects", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
def create_project(command: ProjectCreate) -> ProjectDetail:
    timestamp = _now()
    try:
        with open_database() as connection:
            cursor = connection.execute(
                """
                INSERT INTO projects (name, product_name, description, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (command.name, command.product_name, command.description, timestamp, timestamp),
            )
            return _get_project(connection, cursor.lastrowid)
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="项目名称已存在，请换一个名称") from error


@router.get("/api/projects", response_model=list[ProjectSummary])
def list_projects(
    search: str = Query(default="", max_length=120),
    sort: Literal["updated_desc", "name_asc", "created_asc"] = "updated_desc",
) -> list[ProjectSummary]:
    order_by = {
        "updated_desc": "p.updated_at DESC, p.id DESC",
        "name_asc": "p.name COLLATE NOCASE ASC, p.id ASC",
        "created_asc": "p.created_at ASC, p.id ASC",
    }[sort]
    pattern = f"%{search.strip()}%"
    with open_database() as connection:
        rows = connection.execute(
            f"""
            SELECT p.*, COUNT(v.id) AS product_version_count
            FROM projects p
            LEFT JOIN product_versions v ON v.project_id = p.id
            WHERE p.name LIKE ? COLLATE NOCASE OR p.product_name LIKE ? COLLATE NOCASE
            GROUP BY p.id
            ORDER BY {order_by}
            """,
            (pattern, pattern),
        ).fetchall()
    return [ProjectSummary(**dict(row)) for row in rows]


@router.get("/api/projects/{project_id}", response_model=ProjectDetail)
def get_project(project_id: int) -> ProjectDetail:
    with open_database() as connection:
        return _get_project(connection, project_id)


@router.post(
    "/api/projects/{project_id}/product-versions",
    response_model=ProductVersion,
    status_code=status.HTTP_201_CREATED,
)
def create_product_version(project_id: int, command: ProductVersionCreate) -> ProductVersion:
    timestamp = _now()
    try:
        with open_database() as connection:
            _get_project(connection, project_id)
            cursor = connection.execute(
                """
                INSERT INTO product_versions (project_id, version, name, description, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (project_id, command.version, command.name, command.description, timestamp, timestamp),
            )
            connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
            return _get_version(connection, cursor.lastrowid)
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="当前项目已存在相同版本号") from error


@router.get("/api/product-versions/{version_id}", response_model=ProductVersion)
def get_product_version(version_id: int) -> ProductVersion:
    with open_database() as connection:
        return _get_version(connection, version_id)


@router.patch("/api/product-versions/{version_id}", response_model=ProductVersion)
def update_product_version(version_id: int, command: ProductVersionUpdate) -> ProductVersion:
    changes = command.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="至少提供一个需要修改的字段")
    try:
        with open_database() as connection:
            current = _get_version(connection, version_id)
            timestamp = _now()
            values = {**current.model_dump(), **changes, "updated_at": timestamp}
            connection.execute(
                """
                UPDATE product_versions SET version = ?, name = ?, description = ?, updated_at = ? WHERE id = ?
                """,
                (values["version"], values["name"], values["description"], timestamp, version_id),
            )
            connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (timestamp, current.project_id))
            return _get_version(connection, version_id)
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="当前项目已存在相同版本号") from error


@router.get("/api/projects/{project_id}/deletion-impact", response_model=ProjectDeletionImpact)
def get_project_deletion_impact(project_id: int) -> ProjectDeletionImpact:
    with open_database() as connection:
        project = _get_project(connection, project_id)
        versions = [
            VersionImpactItem(id=item.id, version=item.version, name=item.name) for item in project.product_versions
        ]
        counts = _asset_counts(connection, [item.id for item in project.product_versions])
    return ProjectDeletionImpact(
        project_id=project_id,
        product_versions=versions,
        asset_counts=counts,
        total_affected_assets=sum(counts.values()),
    )


@router.get("/api/product-versions/{version_id}/deletion-impact", response_model=ProductVersionDeletionImpact)
def get_product_version_deletion_impact(version_id: int) -> ProductVersionDeletionImpact:
    with open_database() as connection:
        version = _get_version(connection, version_id)
        counts = _asset_counts(connection, [version_id])
    return ProductVersionDeletionImpact(
        product_version=VersionImpactItem(id=version.id, version=version.version, name=version.name),
        asset_counts=counts,
        total_affected_assets=sum(counts.values()),
    )


@router.delete("/api/product-versions/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product_version(version_id: int, confirm: bool = False) -> Response:
    if not confirm:
        raise HTTPException(status_code=400, detail="请先查看影响范围并确认删除")
    with open_database() as connection:
        version = _get_version(connection, version_id)
        connection.execute("DELETE FROM product_versions WHERE id = ?", (version_id,))
        connection.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (_now(), version.project_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/api/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, confirm: bool = False) -> Response:
    if not confirm:
        raise HTTPException(status_code=400, detail="请先查看影响范围并确认删除")
    with open_database() as connection:
        _get_project(connection, project_id)
        connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/projects/{project_id}/trends", response_model=ProjectTrend)
def get_project_trends(project_id: int) -> ProjectTrend:
    with open_database() as connection:
        _get_project(connection, project_id)
    return ProjectTrend(project_id=project_id, status="empty", message="暂无趋势数据", points=[])
