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

    assert version == 17
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

    with open_database() as connection:
        project_columns = {row[1] for row in connection.execute("PRAGMA table_info(projects)").fetchall()}
        version_foreign_keys = connection.execute("PRAGMA foreign_key_list(product_versions)").fetchall()

    assert {"id", "name", "product_name", "description", "created_at", "updated_at"} <= project_columns
    assert any(row[2] == "projects" and row[3] == "project_id" for row in version_foreign_keys)
    with open_database() as connection:
        source_case_columns = {row[1] for row in connection.execute("PRAGMA table_info(source_test_cases)").fetchall()}
        automation_case_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(automation_test_cases)").fetchall()
        }
        automation_case_foreign_keys = connection.execute("PRAGMA foreign_key_list(automation_test_cases)").fetchall()
    assert {"product_version_id", "import_record_id", "case_number", "source_import_deleted"} <= source_case_columns
    assert {
        "source_test_case_id",
        "case_number",
        "conversion_status",
        "confidence",
        "review_note",
    } <= automation_case_columns
    assert any(
        row[2] == "source_test_cases" and row[3] == "source_test_case_id" for row in automation_case_foreign_keys
    )
