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

    assert version == 21
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
    assert {"validation_status", "feedback_input", "updated_at"} <= automation_case_columns
    history_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(automation_test_case_history)").fetchall()
    }
    assert {"product_version_id", "automation_test_case_id", "event_type", "snapshot"} <= history_columns
    with open_database() as connection:
        package_columns = {row[1] for row in connection.execute("PRAGMA table_info(data_packages)").fetchall()}
        package_foreign_keys = connection.execute("PRAGMA foreign_key_list(data_packages)").fetchall()
    assert {
        "source_task_id",
        "source_run_id",
        "source_type",
        "version_fingerprint",
        "generated_at",
        "validation_status",
    } <= package_columns
    assert any(row[2] == "runs" and row[3] == "source_run_id" for row in package_foreign_keys)
    with open_database() as connection:
        group_columns = {row[1] for row in connection.execute("PRAGMA table_info(test_groups)").fetchall()}
        assignment_foreign_keys = connection.execute(
            "PRAGMA foreign_key_list(test_group_data_package_assignments)"
        ).fetchall()
    assert {"product_version_id", "name", "hidden"} <= group_columns
    assert {row[2] for row in assignment_foreign_keys} == {
        "test_groups",
        "automation_test_cases",
        "data_packages",
        "test_group_automation_cases",
    }


def test_version_seventeen_automation_cases_upgrade_without_losing_existing_candidates(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    connection = sqlite3.connect(tmp_path / "platform.sqlite3")
    connection.executescript(
        """
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT);
        CREATE TABLE product_versions (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL);
        INSERT INTO product_versions (id, project_id) VALUES (1, 1);
        CREATE TABLE source_test_cases (
            id INTEGER PRIMARY KEY, product_version_id INTEGER NOT NULL, case_number TEXT NOT NULL
        );
        INSERT INTO source_test_cases (id, product_version_id, case_number) VALUES (2, 1, 'REC-001');
        CREATE TABLE automation_test_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_version_id INTEGER NOT NULL,
            source_test_case_id INTEGER NOT NULL UNIQUE,
            case_number TEXT UNIQUE,
            title TEXT NOT NULL DEFAULT '', input TEXT NOT NULL DEFAULT '', steps TEXT NOT NULL DEFAULT '',
            expected_result TEXT NOT NULL DEFAULT '', conversion_status TEXT NOT NULL, confidence TEXT NOT NULL,
            review_note TEXT NOT NULL, created_at TEXT NOT NULL,
            FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
            FOREIGN KEY (source_test_case_id) REFERENCES source_test_cases(id) ON DELETE CASCADE
        );
        INSERT INTO automation_test_cases
            (product_version_id, source_test_case_id, case_number, title, conversion_status,
             confidence, review_note, created_at)
        VALUES (1, 2, 'AUTO-000001', '已有候选', 'candidate', 'low', '待审核', '2026-01-01T00:00:00+00:00');
        PRAGMA user_version = 17;
        """
    )
    connection.commit()
    connection.close()

    with open_database() as connection:
        candidate = connection.execute("SELECT * FROM automation_test_cases WHERE id = 1").fetchone()
        assert candidate["case_number"] == "AUTO-000001"
        assert candidate["validation_status"] == "unvalidated"
        assert candidate["updated_at"] == candidate["created_at"]
        connection.execute(
            """
            INSERT INTO automation_test_cases
                (product_version_id, source_test_case_id, case_number, conversion_status, confidence,
                 review_note, created_at, updated_at)
            VALUES (1, 2, 'AUTO-000002', 'manual', 'low', '新增',
                    '2026-01-02T00:00:00+00:00', '2026-01-02T00:00:00+00:00')
            """
        )
        assert connection.execute("SELECT COUNT(*) FROM automation_test_cases").fetchone()[0] == 2


def test_version_twenty_assignment_upgrade_removes_orphaned_group_relation(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    connection = sqlite3.connect(tmp_path / "platform.sqlite3")
    connection.executescript(
        """
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT);
        CREATE TABLE test_groups (id INTEGER PRIMARY KEY);
        CREATE TABLE automation_test_cases (id INTEGER PRIMARY KEY);
        CREATE TABLE data_packages (id INTEGER PRIMARY KEY);
        CREATE TABLE test_group_automation_cases (
            test_group_id INTEGER NOT NULL,
            automation_test_case_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (test_group_id, automation_test_case_id)
        );
        CREATE TABLE test_group_data_package_assignments (
            test_group_id INTEGER NOT NULL,
            automation_test_case_id INTEGER NOT NULL,
            data_package_id INTEGER NOT NULL,
            PRIMARY KEY (test_group_id, automation_test_case_id, data_package_id)
        );
        INSERT INTO test_groups VALUES (1);
        INSERT INTO automation_test_cases VALUES (2);
        INSERT INTO data_packages VALUES (3);
        INSERT INTO test_group_automation_cases VALUES (1, 2, 1);
        INSERT INTO test_group_data_package_assignments VALUES (1, 2, 3);
        PRAGMA user_version = 20;
        """
    )
    connection.commit()
    connection.close()

    with open_database() as connection:
        connection.execute(
            "DELETE FROM test_group_automation_cases WHERE test_group_id = ? AND automation_test_case_id = ?",
            (1, 2),
        )
        assert connection.execute("SELECT COUNT(*) FROM test_group_data_package_assignments").fetchone()[0] == 0
