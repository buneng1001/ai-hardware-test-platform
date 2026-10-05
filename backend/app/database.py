import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

LATEST_SCHEMA_VERSION = 26


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
        current_version = 14

    if current_version < 15:
        connection.executescript(
            """
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                product_name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE product_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                version TEXT NOT NULL COLLATE NOCASE,
                name TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                UNIQUE (project_id, version)
            );
            CREATE INDEX idx_product_versions_project_id ON product_versions(project_id);
            INSERT INTO schema_migrations (version) VALUES (15);
            PRAGMA user_version = 15;
            """
        )
        current_version = 15

    if current_version < 16:
        connection.executescript(
            """
            CREATE TABLE source_test_case_imports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_version_id INTEGER NOT NULL,
                source_filename TEXT NOT NULL,
                field_mapping TEXT NOT NULL,
                import_options TEXT NOT NULL,
                imported_at TEXT NOT NULL,
                FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_source_test_case_imports_version ON source_test_case_imports(product_version_id);
            CREATE TABLE source_test_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_version_id INTEGER NOT NULL,
                import_record_id INTEGER,
                case_number TEXT NOT NULL,
                title TEXT NOT NULL,
                priority TEXT NOT NULL DEFAULT '',
                preconditions TEXT NOT NULL DEFAULT '',
                input TEXT NOT NULL DEFAULT '',
                steps TEXT NOT NULL DEFAULT '',
                expected_result TEXT NOT NULL DEFAULT '',
                test_type TEXT NOT NULL DEFAULT '',
                module TEXT NOT NULL DEFAULT '',
                test_item TEXT NOT NULL DEFAULT '',
                test_result TEXT NOT NULL DEFAULT '',
                test_record TEXT NOT NULL DEFAULT '',
                pre_test_notes TEXT NOT NULL DEFAULT '',
                planned_execution_time TEXT NOT NULL DEFAULT '',
                attachment TEXT NOT NULL DEFAULT '',
                software_version TEXT NOT NULL DEFAULT '',
                source_import_deleted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
                FOREIGN KEY (import_record_id) REFERENCES source_test_case_imports(id) ON DELETE SET NULL,
                UNIQUE (import_record_id, case_number)
            );
            CREATE INDEX idx_source_test_cases_version_filters
                ON source_test_cases(product_version_id, module, test_item, priority, software_version);
            CREATE TABLE source_test_case_selections (
                product_version_id INTEGER NOT NULL,
                source_test_case_id INTEGER NOT NULL,
                selected_at TEXT NOT NULL,
                PRIMARY KEY (product_version_id, source_test_case_id),
                FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
                FOREIGN KEY (source_test_case_id) REFERENCES source_test_cases(id) ON DELETE CASCADE
            );
            INSERT INTO schema_migrations (version) VALUES (16);
            PRAGMA user_version = 16;
            """
        )

    if current_version < 17:
        connection.executescript(
            """
            CREATE TABLE automation_test_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_version_id INTEGER NOT NULL,
                source_test_case_id INTEGER NOT NULL UNIQUE,
                case_number TEXT UNIQUE,
                title TEXT NOT NULL DEFAULT '',
                input TEXT NOT NULL DEFAULT '',
                steps TEXT NOT NULL DEFAULT '',
                expected_result TEXT NOT NULL DEFAULT '',
                conversion_status TEXT NOT NULL,
                confidence TEXT NOT NULL,
                review_note TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
                FOREIGN KEY (source_test_case_id) REFERENCES source_test_cases(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_automation_test_cases_version ON automation_test_cases(product_version_id, id);
            INSERT INTO schema_migrations (version) VALUES (17);
            PRAGMA user_version = 17;
            """
        )
        current_version = 17

    if current_version < 18:
        # SQLite 不支持直接移除旧的来源唯一约束；重建表以允许同一来源派生多个可执行资产，
        # 同时保留已有候选及其稳定编号。
        connection.executescript(
            """
            CREATE TABLE automation_test_cases_v18 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_version_id INTEGER NOT NULL,
                source_test_case_id INTEGER NOT NULL,
                case_number TEXT UNIQUE,
                title TEXT NOT NULL DEFAULT '',
                input TEXT NOT NULL DEFAULT '',
                steps TEXT NOT NULL DEFAULT '',
                expected_result TEXT NOT NULL DEFAULT '',
                conversion_status TEXT NOT NULL,
                confidence TEXT NOT NULL,
                review_note TEXT NOT NULL,
                validation_status TEXT NOT NULL DEFAULT 'unvalidated',
                validation_message TEXT NOT NULL DEFAULT '',
                feedback_input TEXT NOT NULL DEFAULT '',
                feedback_status TEXT NOT NULL DEFAULT 'not_requested',
                feedback_response TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
                FOREIGN KEY (source_test_case_id) REFERENCES source_test_cases(id) ON DELETE CASCADE
            );
            INSERT INTO automation_test_cases_v18
                (id, product_version_id, source_test_case_id, case_number, title, input, steps, expected_result,
                 conversion_status, confidence, review_note, created_at, updated_at)
            SELECT id, product_version_id, source_test_case_id, case_number, title, input, steps, expected_result,
                   conversion_status, confidence, review_note, created_at, created_at
            FROM automation_test_cases;
            DROP TABLE automation_test_cases;
            ALTER TABLE automation_test_cases_v18 RENAME TO automation_test_cases;
            CREATE INDEX idx_automation_test_cases_version ON automation_test_cases(product_version_id, id);
            CREATE TABLE automation_test_case_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_version_id INTEGER NOT NULL,
                automation_test_case_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                snapshot TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_automation_case_history_case ON automation_test_case_history(automation_test_case_id, id);
            INSERT INTO schema_migrations (version) VALUES (18);
            PRAGMA user_version = 18;
            """
        )

    if current_version < 19:
        connection.executescript(
            """
            CREATE TABLE data_packages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_task_id INTEGER NOT NULL,
                source_run_id INTEGER NOT NULL UNIQUE,
                source_type TEXT NOT NULL,
                data_kind TEXT NOT NULL,
                fault_type TEXT,
                version_fingerprint TEXT NOT NULL,
                generated_at TEXT NOT NULL,
                validation_status TEXT NOT NULL,
                validation_message TEXT NOT NULL DEFAULT '',
                files TEXT NOT NULL,
                channels TEXT NOT NULL,
                timestamps TEXT NOT NULL,
                integrity TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (source_task_id) REFERENCES collection_tasks(id),
                FOREIGN KEY (source_run_id) REFERENCES runs(id)
            );
            CREATE INDEX idx_data_packages_source_task ON data_packages(source_task_id, source_run_id DESC);
            CREATE INDEX idx_data_packages_filters
                ON data_packages(source_type, data_kind, fault_type, validation_status);
            INSERT INTO schema_migrations (version) VALUES (19);
            PRAGMA user_version = 19;
            """
        )
        current_version = 19

    if current_version < 20:
        connection.executescript(
            """
            CREATE TABLE test_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_version_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                hidden INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
                UNIQUE (product_version_id, name)
            );
            CREATE INDEX idx_test_groups_version_visibility
                ON test_groups(product_version_id, hidden, updated_at DESC);
            CREATE TABLE test_group_source_cases (
                test_group_id INTEGER NOT NULL,
                source_test_case_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (test_group_id, source_test_case_id),
                FOREIGN KEY (test_group_id) REFERENCES test_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (source_test_case_id) REFERENCES source_test_cases(id) ON DELETE CASCADE
            );
            CREATE TABLE test_group_automation_cases (
                test_group_id INTEGER NOT NULL,
                automation_test_case_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (test_group_id, automation_test_case_id),
                FOREIGN KEY (test_group_id) REFERENCES test_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (automation_test_case_id) REFERENCES automation_test_cases(id) ON DELETE CASCADE
            );
            CREATE TABLE test_group_data_package_assignments (
                test_group_id INTEGER NOT NULL,
                automation_test_case_id INTEGER NOT NULL,
                data_package_id INTEGER NOT NULL,
                PRIMARY KEY (test_group_id, automation_test_case_id, data_package_id),
                FOREIGN KEY (test_group_id) REFERENCES test_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (automation_test_case_id) REFERENCES automation_test_cases(id) ON DELETE CASCADE,
                FOREIGN KEY (test_group_id, automation_test_case_id)
                    REFERENCES test_group_automation_cases(test_group_id, automation_test_case_id) ON DELETE CASCADE,
                FOREIGN KEY (data_package_id) REFERENCES data_packages(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_test_group_assignments_package
                ON test_group_data_package_assignments(data_package_id);
            INSERT INTO schema_migrations (version) VALUES (20);
            PRAGMA user_version = 20;
            """
        )

    if current_version < 21:
        # v0.2.0-rc.1 的早期数据库缺少组内自动化用例的复合外键；重建后删除用例范围会一并删除关联。
        connection.executescript(
            """
            CREATE TABLE test_group_data_package_assignments_v21 (
                test_group_id INTEGER NOT NULL,
                automation_test_case_id INTEGER NOT NULL,
                data_package_id INTEGER NOT NULL,
                PRIMARY KEY (test_group_id, automation_test_case_id, data_package_id),
                FOREIGN KEY (test_group_id) REFERENCES test_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (automation_test_case_id) REFERENCES automation_test_cases(id) ON DELETE CASCADE,
                FOREIGN KEY (test_group_id, automation_test_case_id)
                    REFERENCES test_group_automation_cases(test_group_id, automation_test_case_id) ON DELETE CASCADE,
                FOREIGN KEY (data_package_id) REFERENCES data_packages(id) ON DELETE CASCADE
            );
            INSERT INTO test_group_data_package_assignments_v21
                (test_group_id, automation_test_case_id, data_package_id)
            SELECT assignment.test_group_id, assignment.automation_test_case_id, assignment.data_package_id
            FROM test_group_data_package_assignments assignment
            JOIN test_group_automation_cases item
              ON item.test_group_id = assignment.test_group_id
             AND item.automation_test_case_id = assignment.automation_test_case_id;
            DROP TABLE test_group_data_package_assignments;
            ALTER TABLE test_group_data_package_assignments_v21 RENAME TO test_group_data_package_assignments;
            CREATE INDEX idx_test_group_assignments_package
                ON test_group_data_package_assignments(data_package_id);
            INSERT INTO schema_migrations (version) VALUES (21);
            PRAGMA user_version = 21;
            """
        )

    if current_version < 22:
        # 自动化执行记录保存事实快照，不引用可变业务资产，避免测试组、用例或数据包后续修改覆盖历史。
        connection.executescript(
            """
            CREATE TABLE automation_execution_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_group_id INTEGER NOT NULL,
                product_version_id INTEGER NOT NULL,
                execution_number INTEGER NOT NULL,
                status TEXT NOT NULL,
                execution_mode TEXT NOT NULL,
                group_snapshot TEXT NOT NULL,
                configuration_snapshot TEXT NOT NULL,
                summary TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                UNIQUE (test_group_id, execution_number)
            );
            CREATE INDEX idx_automation_execution_records_group
                ON automation_execution_records(test_group_id, id DESC);
            CREATE TABLE automation_execution_case_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                automation_execution_id INTEGER NOT NULL,
                automation_test_case_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                status TEXT NOT NULL,
                message TEXT NOT NULL,
                case_snapshot TEXT NOT NULL,
                FOREIGN KEY (automation_execution_id) REFERENCES automation_execution_records(id) ON DELETE CASCADE,
                UNIQUE (automation_execution_id, automation_test_case_id)
            );
            CREATE TABLE automation_execution_data_packages (
                automation_execution_id INTEGER NOT NULL,
                automation_test_case_id INTEGER NOT NULL,
                data_package_id INTEGER NOT NULL,
                package_snapshot TEXT NOT NULL,
                PRIMARY KEY (automation_execution_id, automation_test_case_id, data_package_id),
                FOREIGN KEY (automation_execution_id) REFERENCES automation_execution_records(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_automation_execution_packages_package
                ON automation_execution_data_packages(data_package_id);
            CREATE TRIGGER automation_execution_records_immutable
            BEFORE UPDATE ON automation_execution_records
            BEGIN SELECT RAISE(ABORT, 'automation execution records are immutable'); END;
            CREATE TRIGGER automation_execution_case_results_immutable
            BEFORE UPDATE ON automation_execution_case_results
            BEGIN SELECT RAISE(ABORT, 'automation execution case results are immutable'); END;
            CREATE TRIGGER automation_execution_data_packages_immutable
            BEFORE UPDATE ON automation_execution_data_packages
            BEGIN SELECT RAISE(ABORT, 'automation execution data packages are immutable'); END;
            INSERT INTO schema_migrations (version) VALUES (22);
            PRAGMA user_version = 22;
            """
        )

    if current_version < 23:
        # 执行状态可在受控生命周期中变化；事实快照和结果明细仍绝不允许被覆盖。
        connection.executescript(
            """
            DROP TRIGGER automation_execution_records_immutable;
            CREATE TRIGGER automation_execution_snapshots_immutable
            BEFORE UPDATE OF group_snapshot, configuration_snapshot, summary ON automation_execution_records
            BEGIN SELECT RAISE(ABORT, 'automation execution snapshots are immutable'); END;
            INSERT INTO schema_migrations (version) VALUES (23);
            PRAGMA user_version = 23;
            """
        )

    if current_version < 24:
        # 人工结果独立于 v0.1 运行记录，按测试组中的来源用例和一次录入批次保存。
        connection.executescript(
            """
            CREATE TABLE manual_test_result_batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_group_id INTEGER NOT NULL,
                product_version_id INTEGER NOT NULL,
                batch_number INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (test_group_id) REFERENCES test_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE,
                UNIQUE (test_group_id, batch_number)
            );
            CREATE INDEX idx_manual_test_result_batches_group
                ON manual_test_result_batches(test_group_id, id DESC);
            CREATE TABLE manual_test_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                manual_test_result_batch_id INTEGER NOT NULL,
                source_test_case_id INTEGER NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'blocked', 'not_executed')),
                actual_result TEXT,
                notes TEXT,
                executed_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (manual_test_result_batch_id) REFERENCES manual_test_result_batches(id) ON DELETE CASCADE,
                FOREIGN KEY (source_test_case_id) REFERENCES source_test_cases(id) ON DELETE RESTRICT,
                UNIQUE (manual_test_result_batch_id, source_test_case_id)
            );
            CREATE INDEX idx_manual_test_results_source_case ON manual_test_results(source_test_case_id);
            CREATE TABLE manual_test_result_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                manual_test_result_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                storage_status TEXT NOT NULL DEFAULT 'stored' CHECK (storage_status IN ('stored', 'cleaned')),
                usage_status TEXT NOT NULL DEFAULT 'unused' CHECK (usage_status IN ('unused', 'used')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (manual_test_result_id) REFERENCES manual_test_results(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_manual_test_result_attachments_result
                ON manual_test_result_attachments(manual_test_result_id, id);
            CREATE TABLE report_staleness_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_group_id INTEGER NOT NULL,
                product_version_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (test_group_id) REFERENCES test_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_report_staleness_events_group
                ON report_staleness_events(test_group_id, id DESC);
            INSERT INTO schema_migrations (version) VALUES (24);
            PRAGMA user_version = 24;
            """
        )

    if current_version < 25:
        # 批次范围是报告事实的一部分；后续增删测试组成员不能改写历史“未执行”表达。
        connection.executescript(
            """
            ALTER TABLE manual_test_result_batches ADD COLUMN scope_snapshot TEXT NOT NULL DEFAULT '[]';
            INSERT INTO schema_migrations (version) VALUES (25);
            PRAGMA user_version = 25;
            """
        )

    if current_version < 26:
        # 最终事实报告是独立快照；选择的执行和人工批次后续变更、删除均不能改写报告内容。
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS online_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_group_id INTEGER NOT NULL,
                product_version_id INTEGER NOT NULL,
                automation_execution_id INTEGER,
                manual_batch_ids TEXT NOT NULL,
                snapshot TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (test_group_id) REFERENCES test_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (product_version_id) REFERENCES product_versions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_online_reports_group ON online_reports(test_group_id, id DESC);
            INSERT OR IGNORE INTO schema_migrations (version) VALUES (26);
            PRAGMA user_version = 26;
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
        connection.execute("PRAGMA foreign_keys = ON")
        migrate_database(connection)
        yield connection


def check_database() -> bool:
    """通过真实 SQLite 查询验证项目数据目录可写且数据库可用。"""
    with open_database() as connection:
        result = connection.execute("SELECT 1").fetchone()

    return tuple(result) == (1,)
