import sqlite3
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.database import open_database

router = APIRouter(prefix="/api/collection-tasks", tags=["collection tasks"])


class CollectionTaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    mode: Literal["quick"]
    scenario: Literal["normal"]

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized_name = value.strip()
        if not normalized_name:
            raise ValueError("任务名称不能为空")
        return normalized_name

    @field_validator("mode", mode="before")
    @classmethod
    def validate_mode(cls, value: object) -> object:
        if value != "quick":
            raise ValueError("当前只支持快速模式")
        return value

    @field_validator("scenario", mode="before")
    @classmethod
    def validate_scenario(cls, value: object) -> object:
        if value != "normal":
            raise ValueError("当前只支持正常采集场景")
        return value


class CollectionTask(BaseModel):
    id: int
    name: str
    mode: Literal["quick"]
    scenario: Literal["normal"]
    status: Literal["draft"]
    created_at: datetime


def task_from_row(row: sqlite3.Row) -> CollectionTask:
    return CollectionTask.model_validate(dict(row))


@router.post("", response_model=CollectionTask, status_code=status.HTTP_201_CREATED)
def create_collection_task(command: CollectionTaskCreate) -> CollectionTask:
    created_at = datetime.now(UTC)
    with open_database() as connection:
        cursor = connection.execute(
            """
            INSERT INTO collection_tasks (name, mode, scenario, status, created_at)
            VALUES (?, ?, ?, 'draft', ?)
            """,
            (command.name, command.mode, command.scenario, created_at.isoformat()),
        )
        task_id = cursor.lastrowid
        row = connection.execute("SELECT * FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=500, detail="采集任务保存失败")
    return task_from_row(row)


@router.get("", response_model=list[CollectionTask])
def list_collection_tasks() -> list[CollectionTask]:
    with open_database() as connection:
        rows = connection.execute("SELECT * FROM collection_tasks ORDER BY id DESC").fetchall()

    return [task_from_row(row) for row in rows]


@router.get("/{task_id}", response_model=CollectionTask)
def get_collection_task(task_id: int) -> CollectionTask:
    with open_database() as connection:
        row = connection.execute("SELECT * FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="采集任务不存在")
    return task_from_row(row)
