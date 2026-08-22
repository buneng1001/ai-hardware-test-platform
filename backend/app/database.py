import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

LATEST_SCHEMA_VERSION = 3


def migrate_database(connection: sqlite3.Connection) -> None:
    """按 SQLite user_version 顺序应用洁净重写的本地迁移。"""
    current_version: int = connection.execute("PRAGMA user_version").fetchone()[0]
    if current_version < 1:
        connection.executescript(
            """
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO schema_migrations (version) VALUES (1);
            PRAGMA user_version = 1;
            """
        )
        current_version = 1

    if current_version < 2:
        connection.executescript(
            """
            CREATE TABLE collection_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                mode TEXT NOT NULL,
                scenario TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            INSERT INTO schema_migrations (version) VALUES (2);
            PRAGMA user_version = 2;
            """
        )
        current_version = 2

    if current_version < LATEST_SCHEMA_VERSION:
        connection.executescript(
            """
            CREATE TABLE runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_task_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                configuration_snapshot TEXT NOT NULL,
                events TEXT NOT NULL,
                artifacts TEXT NOT NULL,
                checks TEXT NOT NULL,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                error TEXT
            );
            INSERT INTO schema_migrations (version) VALUES (3);
            PRAGMA user_version = 3;
            """
        )


def get_data_dir() -> Path:
    return Path(os.getenv("APP_DATA_DIR", "data"))


@contextmanager
def open_database() -> Iterator[sqlite3.Connection]:
    """打开项目内数据库，并保证调用方始终使用最新 schema。"""
    data_dir = get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(data_dir / "platform.sqlite3") as connection:
        connection.row_factory = sqlite3.Row
        migrate_database(connection)
        yield connection


def check_database() -> bool:
    """通过真实 SQLite 查询验证项目数据目录可写且数据库可用。"""
    with open_database() as connection:
        result = connection.execute("SELECT 1").fetchone()

    return tuple(result) == (1,)
