import os
import sqlite3
from pathlib import Path

LATEST_SCHEMA_VERSION = 1


def migrate_database(connection: sqlite3.Connection) -> None:
    """按 SQLite user_version 顺序应用洁净重写的本地迁移。"""
    current_version = connection.execute("PRAGMA user_version").fetchone()[0]
    if current_version >= LATEST_SCHEMA_VERSION:
        return

    # 版本 1 只建立迁移账本，后续 ticket 再追加领域表迁移。
    connection.execute(
        """
        CREATE TABLE schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", (LATEST_SCHEMA_VERSION,))
    connection.execute(f"PRAGMA user_version = {LATEST_SCHEMA_VERSION}")


def check_database() -> bool:
    """通过真实 SQLite 查询验证项目数据目录可写且数据库可用。"""
    data_dir = Path(os.getenv("APP_DATA_DIR", "data"))
    data_dir.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(data_dir / "platform.sqlite3") as connection:
        migrate_database(connection)
        result = connection.execute("SELECT 1").fetchone()

    return result == (1,)
