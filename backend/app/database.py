import os
import sqlite3
from pathlib import Path


def check_database() -> bool:
    """通过真实 SQLite 查询验证项目数据目录可写且数据库可用。"""
    data_dir = Path(os.getenv("APP_DATA_DIR", "data"))
    data_dir.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(data_dir / "platform.sqlite3") as connection:
        result = connection.execute("SELECT 1").fetchone()

    return result == (1,)
