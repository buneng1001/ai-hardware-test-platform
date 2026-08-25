import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.collection_tasks import router as collection_tasks_router
from app.database import check_database
from app.diagnosis import router as diagnosis_router
from app.evidence_package import router as evidence_router
from app.manual_check_results import router as manual_check_results_router
from app.manual_result_import import router as manual_result_import_router
from app.report import router as report_router
from app.run_executor import RunExecutor
from app.runs import process_run, recover_unfinished_runs
from app.runs import router as runs_router


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """启动时恢复可信状态，关闭时让执行器停在安全阶段边界。"""
    recover_unfinished_runs()
    application.state.run_executor = RunExecutor(process_run)
    try:
        yield
    finally:
        application.state.run_executor.stop()


app = FastAPI(title="智能硬件测试执行与诊断平台", version="0.1.0", lifespan=lifespan)
app.include_router(collection_tasks_router)
app.include_router(manual_check_results_router)
app.include_router(manual_result_import_router)
app.include_router(runs_router)
app.include_router(report_router)
app.include_router(evidence_router)
app.include_router(diagnosis_router)


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
