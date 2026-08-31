import sqlite3
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator, model_validator

from app.database import open_database
from app.run_models import (
    EvaluationConfiguration,
    ImuConfiguration,
    ReferenceChannel,
    RunConfigurationSnapshot,
    Scenario,
    VideoConfiguration,
)

router = APIRouter(prefix="/api/collection-tasks", tags=["collection tasks"])


PRESET_CONFIGURATIONS = {
    "quick": {
        "duration_seconds": 2,
        "video": {
            "channels": 2,
            "resolution": "640x360",
            "fps": 30,
            "container": "mp4",
            "bitrate_kbps": 3000,
        },
        "imu": {"format": "csv", "sample_rate_hz": 100},
        "random_seed": 20260822,
    },
    "standard": {
        "duration_seconds": 5,
        "video": {
            "channels": 4,
            "resolution": "1280x720",
            "fps": 30,
            "container": "mp4",
            "bitrate_kbps": 6000,
        },
        "imu": {"format": "csv", "sample_rate_hz": 200},
        "random_seed": 20260822,
    },
}


class CollectionTaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    mode: Literal["quick", "standard", "custom"]
    scenario: Scenario
    duration_seconds: int | None = None
    video: VideoConfiguration | None = None
    imu: ImuConfiguration | None = None
    random_seed: int | None = None
    reference_channel: ReferenceChannel = "camera_1"
    evaluation: EvaluationConfiguration | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized_name = value.strip()
        if not normalized_name:
            raise ValueError("任务名称不能为空")
        return normalized_name

    @field_validator("scenario", mode="before")
    @classmethod
    def validate_scenario(cls, value: object) -> object:
        allowed = {
            "normal",
            "video_drop",
            "imu_anomaly",
            "storage_exhaustion",
            "temperature_combination",
            "fixed_offset",
            "linear_drift",
        }
        if value not in allowed:
            raise ValueError("当前只支持正常采集、单路视频掉帧、IMU 异常、存储不足或固定偏移场景")
        return value

    @model_validator(mode="after")
    def apply_preset_and_validate(self) -> "CollectionTaskCreate":
        if self.mode in PRESET_CONFIGURATIONS:
            preset = PRESET_CONFIGURATIONS[self.mode]
            self.duration_seconds = preset["duration_seconds"]
            self.video = VideoConfiguration(**preset["video"])
            self.imu = ImuConfiguration(**preset["imu"])
            if self.random_seed is None:
                self.random_seed = preset["random_seed"]
        elif None in (self.duration_seconds, self.video, self.imu, self.random_seed):
            raise ValueError("自定义模式必须提供完整数据参数")

        self.snapshot()
        return self

    def snapshot(self) -> RunConfigurationSnapshot:
        return RunConfigurationSnapshot.model_validate(self.model_dump(exclude={"name"}))


class CollectionTask(BaseModel):
    id: int
    name: str
    label: str = ""
    mode: Literal["quick", "standard", "custom"]
    scenario: Scenario
    duration_seconds: int
    video: VideoConfiguration
    imu: ImuConfiguration
    random_seed: int
    reference_channel: ReferenceChannel
    evaluation: EvaluationConfiguration | None = None
    status: Literal["draft"]
    source: Literal["synthetic_generated", "imported_actual_data"] = "synthetic_generated"
    archived: bool = False
    created_at: datetime


def task_from_row(row: sqlite3.Row) -> CollectionTask:
    values = dict(row)
    snapshot = RunConfigurationSnapshot.model_validate_json(values.pop("configuration"))
    values["archived"] = bool(values.get("archived", 0))
    return CollectionTask.model_validate(values | snapshot.model_dump())


class SavedTask(BaseModel):
    """已保存任务的列表读模型，集中表达来源与生命周期状态。"""

    id: int
    name: str
    source: Literal["synthetic_generated", "imported_actual_data"]
    execution_status: Literal["never_executed", "has_runs"]
    archived: bool
    run_count: int
    runs: list["SavedTaskRun"]
    created_at: datetime


class SavedTaskRun(BaseModel):
    """已保存任务卡片中用于追溯的运行摘要。"""

    id: int
    execution_number: int
    status: str
    created_at: datetime
    completed_at: datetime | None


class SavedTaskPage(BaseModel):
    items: list[SavedTask]
    page: int
    page_size: int
    total: int


@router.post("", response_model=CollectionTask, status_code=status.HTTP_201_CREATED)
def create_collection_task(command: CollectionTaskCreate) -> CollectionTask:
    created_at = datetime.now(UTC)
    with open_database() as connection:
        # 先锁定写事务，避免两个并发请求同时通过重名检查。
        connection.execute("BEGIN IMMEDIATE")
        duplicate = connection.execute(
            "SELECT 1 FROM collection_tasks WHERE name COLLATE NOCASE = ? COLLATE NOCASE LIMIT 1",
            (command.name,),
        ).fetchone()
        if duplicate is not None:
            raise HTTPException(status_code=409, detail="任务名称已存在，请换一个名称")
        cursor = connection.execute(
            """
            INSERT INTO collection_tasks (name, mode, scenario, status, created_at, configuration)
            VALUES (?, ?, ?, 'draft', ?, ?)
            """,
            (
                command.name,
                command.mode,
                command.scenario,
                created_at.isoformat(),
                command.snapshot().model_dump_json(),
            ),
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


def _saved_task_from_row(
    row: sqlite3.Row,
    runs: list[SavedTaskRun] | None = None,
) -> SavedTask:
    return SavedTask(
        id=row["id"],
        name=row["name"],
        source=row["source"],
        execution_status="has_runs" if row["run_count"] else "never_executed",
        archived=bool(row["archived"]),
        run_count=row["run_count"],
        runs=runs or [],
        created_at=row["created_at"],
    )


@router.get("/saved", response_model=SavedTaskPage)
def list_saved_tasks(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=10),
    source: Literal["synthetic_generated", "imported_actual_data"] | None = None,
    execution_status: Literal["never_executed", "has_runs"] | None = None,
    archived: bool | None = None,
) -> SavedTaskPage:
    filters: list[str] = []
    parameters: list[object] = []
    if source is not None:
        filters.append("t.source = ?")
        parameters.append(source)
    if archived is not None:
        filters.append("t.archived = ?")
        parameters.append(int(archived))
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    having = ""
    if execution_status == "never_executed":
        having = "HAVING COUNT(r.id) = 0"
    elif execution_status == "has_runs":
        having = "HAVING COUNT(r.id) > 0"
    with open_database() as connection:
        total = connection.execute(
            f"SELECT COUNT(*) FROM (SELECT t.id FROM collection_tasks t LEFT JOIN runs r "
            f"ON r.collection_task_id = t.id {where} GROUP BY t.id {having})",
            parameters,
        ).fetchone()[0]
        rows = connection.execute(
            f"SELECT t.id, t.name, t.source, t.archived, t.created_at, COUNT(r.id) AS run_count "
            f"FROM collection_tasks t LEFT JOIN runs r ON r.collection_task_id = t.id {where} "
            f"GROUP BY t.id {having} ORDER BY t.id DESC LIMIT ? OFFSET ?",
            [*parameters, page_size, (page - 1) * page_size],
        ).fetchall()
        task_ids = [row["id"] for row in rows]
        run_rows = []
        if task_ids:
            placeholders = ",".join("?" for _ in task_ids)
            run_rows = connection.execute(
                f"SELECT id, collection_task_id, task_execution_number, status, created_at, completed_at "
                f"FROM runs WHERE collection_task_id IN ({placeholders}) "
                "ORDER BY task_execution_number DESC, id DESC",
                task_ids,
            ).fetchall()
    runs_by_task: dict[int, list[SavedTaskRun]] = {task_id: [] for task_id in task_ids}
    for run in run_rows:
        runs_by_task[run["collection_task_id"]].append(
            SavedTaskRun(
                id=run["id"],
                execution_number=run["task_execution_number"],
                status=run["status"],
                created_at=run["created_at"],
                completed_at=run["completed_at"],
            )
        )
    return SavedTaskPage(
        items=[_saved_task_from_row(row, runs_by_task[row["id"]]) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection_task(task_id: int) -> None:
    with open_database() as connection:
        task = connection.execute("SELECT id FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()
        if task is None:
            raise HTTPException(status_code=404, detail="采集任务不存在")
        run_count = connection.execute("SELECT COUNT(*) FROM runs WHERE collection_task_id = ?", (task_id,)).fetchone()[
            0
        ]
        if run_count:
            raise HTTPException(status_code=409, detail="已有运行记录的任务只能归档，不能删除")
        connection.execute("DELETE FROM collection_tasks WHERE id = ?", (task_id,))


@router.post("/{task_id}/archive", response_model=SavedTask)
def archive_collection_task(task_id: int) -> SavedTask:
    with open_database() as connection:
        task = connection.execute("SELECT id FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()
        if task is None:
            raise HTTPException(status_code=404, detail="采集任务不存在")
        connection.execute("UPDATE collection_tasks SET archived = 1 WHERE id = ?", (task_id,))
        row = connection.execute(
            "SELECT t.id, t.name, t.source, t.archived, t.created_at, COUNT(r.id) AS run_count "
            "FROM collection_tasks t LEFT JOIN runs r ON r.collection_task_id = t.id "
            "WHERE t.id = ? GROUP BY t.id",
            (task_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="任务归档状态读取失败")
    return _saved_task_from_row(row)


@router.get("/{task_id}", response_model=CollectionTask)
def get_collection_task(task_id: int) -> CollectionTask:
    with open_database() as connection:
        row = connection.execute("SELECT * FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="采集任务不存在")
    return task_from_row(row)
