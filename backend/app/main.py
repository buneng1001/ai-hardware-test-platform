import sqlite3
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.collection_tasks import router as collection_tasks_router
from app.database import check_database


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]


app = FastAPI(title="智能硬件测试执行与诊断平台", version="0.1.0")
app.include_router(collection_tasks_router)


@app.get("/api/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """返回服务和本地 SQLite 的外部可观察健康状态。"""
    try:
        database_available = check_database()
    except (OSError, sqlite3.Error) as error:
        raise HTTPException(status_code=503, detail="database unavailable") from error

    if not database_available:
        raise HTTPException(status_code=503, detail="database unavailable")

    return HealthResponse(status="ok", database="ok")
