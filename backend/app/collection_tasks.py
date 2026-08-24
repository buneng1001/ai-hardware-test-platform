import sqlite3
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator

from app.database import open_database
from app.run_models import ImuConfiguration, RunConfigurationSnapshot, Scenario, VideoConfiguration

router = APIRouter(prefix="/api/collection-tasks", tags=["collection tasks"])


PRESET_CONFIGURATIONS = {
    "quick": {
        "duration_seconds": 2,
        "video": {"channels": 1, "resolution": "640x360", "fps": 15, "container": "mp4"},
        "imu": {"format": "csv", "sample_rate_hz": 50},
        "random_seed": 20260822,
    },
    "standard": {
        "duration_seconds": 5,
        "video": {"channels": 4, "resolution": "1280x720", "fps": 30, "container": "mp4"},
        "imu": {"format": "csv", "sample_rate_hz": 100},
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
        allowed = {"normal", "video_drop", "imu_anomaly", "storage_exhaustion"}
        if value not in allowed:
            raise ValueError("当前只支持正常采集、单路视频掉帧、IMU 异常或存储不足场景")
        return value

    @model_validator(mode="after")
    def apply_preset_and_validate(self) -> "CollectionTaskCreate":
        if self.mode in PRESET_CONFIGURATIONS:
            preset = PRESET_CONFIGURATIONS[self.mode]
            self.duration_seconds = preset["duration_seconds"]
            self.video = VideoConfiguration(**preset["video"])
            self.imu = ImuConfiguration(**preset["imu"])
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
    mode: Literal["quick", "standard", "custom"]
    scenario: Scenario
    duration_seconds: int
    video: VideoConfiguration
    imu: ImuConfiguration
    random_seed: int
    status: Literal["draft"]
    created_at: datetime


def task_from_row(row: sqlite3.Row) -> CollectionTask:
    values = dict(row)
    snapshot = RunConfigurationSnapshot.model_validate_json(values.pop("configuration"))
    return CollectionTask.model_validate(values | snapshot.model_dump())


@router.post("", response_model=CollectionTask, status_code=status.HTTP_201_CREATED)
def create_collection_task(command: CollectionTaskCreate) -> CollectionTask:
    created_at = datetime.now(UTC)
    with open_database() as connection:
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


@router.get("/{task_id}", response_model=CollectionTask)
def get_collection_task(task_id: int) -> CollectionTask:
    with open_database() as connection:
        row = connection.execute("SELECT * FROM collection_tasks WHERE id = ?", (task_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="采集任务不存在")
    return task_from_row(row)
