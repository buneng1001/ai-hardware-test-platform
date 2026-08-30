import sqlite3

from app.database import open_database


def test_version_seven_database_upgrades_without_repeating_alignment_column(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    connection = sqlite3.connect(tmp_path / "platform.sqlite3")
    connection.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)")
    connection.execute(
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
            error TEXT,
            generation_metadata TEXT NOT NULL DEFAULT '{}',
            alignment_result TEXT NOT NULL DEFAULT '{}'
        )
        """
    )
    connection.execute("PRAGMA user_version = 7")
    connection.commit()
    connection.close()

    with open_database() as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(runs)").fetchall()}
        version = connection.execute("PRAGMA user_version").fetchone()[0]

    assert version == 14
    assert "alignment_result" in columns
    with open_database() as connection:
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'diagnosis_runs'"
            ).fetchone()
            is not None
        )
        diagnosis_columns = {row[1] for row in connection.execute("PRAGMA table_info(diagnosis_runs)").fetchall()}
    assert "provider" in diagnosis_columns
    assert "evaluation_result" in columns
