import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

LATEST_SCHEMA_VERSION = 14


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

    if current_version < 3:
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
        current_version = 3

    if current_version < 4:
        connection.executescript(
            """
            ALTER TABLE collection_tasks ADD COLUMN configuration TEXT;
            UPDATE collection_tasks
            SET configuration = '{"mode":"quick","scenario":"normal","duration_seconds":2,'
                || '"video":{"channels":1,"resolution":"640x360","fps":15,"container":"mp4","codec":"h264"},'
                || '"imu":{"format":"csv","sample_rate_hz":50},"random_seed":20260822}'
            WHERE configuration IS NULL;
            INSERT INTO schema_migrations (version) VALUES (4);
            PRAGMA user_version = 4;
            """
        )
        current_version = 4

    if current_version < 5:
        connection.executescript(
            """
            ALTER TABLE runs ADD COLUMN generation_metadata TEXT NOT NULL DEFAULT '{}';
            INSERT INTO schema_migrations (version) VALUES (5);
            PRAGMA user_version = 5;
            """
        )
        current_version = 5

    if current_version < 6:
        connection.executescript(
            """
            CREATE TABLE manual_check_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                actual_result TEXT,
                notes TEXT,
                executed_at TEXT,
                attachment TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (run_id) REFERENCES runs(id)
            );
            CREATE INDEX idx_manual_check_results_run_id ON manual_check_results(run_id);
            INSERT INTO schema_migrations (version) VALUES (6);
            PRAGMA user_version = 6;
            """
        )
        current_version = 6

    if current_version < 7:
        connection.executescript(
            """
            ALTER TABLE runs ADD COLUMN alignment_result TEXT NOT NULL DEFAULT '{}';
            INSERT INTO schema_migrations (version) VALUES (7);
            PRAGMA user_version = 7;
            """
        )
        current_version = 7

    if current_version < 8:
        connection.executescript(
            """
            ALTER TABLE runs ADD COLUMN evaluation_result TEXT NOT NULL DEFAULT '{}';
            INSERT INTO schema_migrations (version) VALUES (8);
            PRAGMA user_version = 8;
            """
        )

    if current_version < 9:
        connection.executescript(
            """
            CREATE TABLE diagnosis_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                model TEXT NOT NULL,
                prompt_version TEXT NOT NULL,
                is_mock INTEGER NOT NULL,
                evidence_package TEXT NOT NULL,
                output TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                error TEXT,
                FOREIGN KEY (run_id) REFERENCES runs(id)
            );
            CREATE INDEX idx_diagnosis_runs_run_id ON diagnosis_runs(run_id);
            INSERT INTO schema_migrations (version) VALUES (9);
            PRAGMA user_version = 9;
            """
        )

    if current_version < 10:
        connection.executescript(
            """
            ALTER TABLE diagnosis_runs ADD COLUMN evaluation TEXT;
            INSERT INTO schema_migrations (version) VALUES (10);
            PRAGMA user_version = 10;
            """
        )

    if current_version < 11:
        collection_tasks_exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'collection_tasks'"
        ).fetchone()
        if collection_tasks_exists:
            connection.executescript(
                """
                ALTER TABLE collection_tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'synthetic_generated';
                ALTER TABLE collection_tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
                """
            )
        connection.executescript(
            """
            ALTER TABLE runs ADD COLUMN task_execution_number INTEGER NOT NULL DEFAULT 1;
            UPDATE runs AS current_run
            SET task_execution_number = (
                SELECT COUNT(*) FROM runs AS previous_run
                WHERE previous_run.collection_task_id = current_run.collection_task_id
                  AND previous_run.id <= current_run.id
            );
            INSERT INTO schema_migrations (version) VALUES (11);
            PRAGMA user_version = 11;
            """
        )

    if current_version < 12:
        connection.executescript(
            """
            ALTER TABLE diagnosis_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'siliconflow';
            INSERT INTO schema_migrations (version) VALUES (12);
            PRAGMA user_version = 12;
            """
        )
        current_version = 12

    if current_version < 13:
        connection.executescript(
            """
            CREATE TABLE import_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sha256 TEXT NOT NULL UNIQUE,
                source_filename TEXT NOT NULL,
                first_imported_at TEXT NOT NULL,
                validator_version TEXT NOT NULL,
                status TEXT NOT NULL,
                permission_confirmed INTEGER NOT NULL,
                staging_path TEXT NOT NULL,
                formal_path TEXT,
                validation_result TEXT NOT NULL DEFAULT '{}',
                created_task_id INTEGER,
                FOREIGN KEY (created_task_id) REFERENCES collection_tasks(id)
            );
            CREATE INDEX idx_import_records_sha256 ON import_records(sha256);
            INSERT INTO schema_migrations (version) VALUES (13);
            PRAGMA user_version = 13;
            """
        )

        current_version = 13

    if current_version < 14:
        collection_tasks_exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'collection_tasks'"
        ).fetchone()
        if collection_tasks_exists:
            connection.execute("ALTER TABLE collection_tasks ADD COLUMN label TEXT NOT NULL DEFAULT ''")
        connection.executescript("INSERT INTO schema_migrations (version) VALUES (14); PRAGMA user_version = 14;")


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
