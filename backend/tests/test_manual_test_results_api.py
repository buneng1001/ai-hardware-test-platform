from fastapi.testclient import TestClient

from app.database import open_database
from app.main import app


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    return TestClient(app)


def _manual_group(client: TestClient) -> tuple[int, int, int]:
    project = client.post("/api/projects", json={"name": "Atlas", "product_name": "Camera"}).json()
    version = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()
    client.post(
        f"/api/product-versions/{version['id']}/source-test-case-imports",
        json={
            "source_filename": "cases.csv",
            "field_mapping": {"case_number": "编号", "title": "标题", "test_type": "测试类型"},
            "rows": [
                {"编号": "SRC-MANUAL", "标题": "外观检查", "测试类型": "manual"},
                {"编号": "SRC-MIXED", "标题": "按键检查", "测试类型": "mixed"},
                {"编号": "SRC-AUTO", "标题": "自动录制", "测试类型": "automation"},
            ],
        },
    ).raise_for_status()
    cases = client.get(f"/api/product-versions/{version['id']}/source-test-cases").json()["items"]
    ids = {item["case_number"]: item["id"] for item in cases}
    group = client.post(f"/api/product-versions/{version['id']}/test-groups", json={"name": "基础回归"}).json()
    client.post(
        f"/api/test-groups/{group['id']}/source-test-cases",
        json={"case_ids": list(ids.values())},
    ).raise_for_status()
    return group["id"], version["id"], ids["SRC-MANUAL"]


def test_manual_results_are_scoped_saved_in_batches_and_restored(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        group_id, version_id, manual_case_id = _manual_group(client)
        page = client.get(f"/api/test-groups/{group_id}/manual-test-result-batches")
        assert page.status_code == 200
        assert page.json()["product_version_id"] == version_id
        assert [item["case_number"] for item in page.json()["cases"]] == ["SRC-MANUAL", "SRC-MIXED"]

        created = client.post(
            f"/api/test-groups/{group_id}/manual-test-result-batches",
            json={
                "results": [
                    {
                        "source_test_case_id": manual_case_id,
                        "status": "passed",
                        "actual_result": "无划痕",
                        "notes": "自然光检查",
                        "executed_at": "2026-10-04T09:00:00Z",
                    }
                ]
            },
        )
        assert created.status_code == 201
        batch = created.json()
        assert batch["batch_number"] == 1
        assert batch["results"][0]["status"] == "passed"
        assert batch["report_input"] == [
            {
                "result_id": batch["results"][0]["id"],
                "source_test_case_id": manual_case_id,
                "status": "passed",
                "actual_result": "无划痕",
                "notes": "自然光检查",
                "executed_at": "2026-10-04T09:00:00Z",
            },
            {
                "result_id": None,
                "source_test_case_id": next(
                    item["id"] for item in page.json()["cases"] if item["case_number"] == "SRC-MIXED"
                ),
                "status": "not_executed",
                "actual_result": None,
                "notes": None,
                "executed_at": None,
            },
        ]

        restored = client.get(f"/api/test-groups/{group_id}/manual-test-result-batches").json()
        assert restored["batches"][0]["id"] == batch["id"]
        assert restored["batches"][0]["results"][0]["actual_result"] == "无划痕"
        mixed_case_id = next(item["id"] for item in page.json()["cases"] if item["case_number"] == "SRC-MIXED")
        assert client.delete(f"/api/test-groups/{group_id}/source-test-cases/{mixed_case_id}").status_code == 204
        historical = client.get(f"/api/test-groups/{group_id}/manual-test-result-batches").json()["batches"][0]
        assert [item["source_test_case_id"] for item in historical["report_input"]] == [manual_case_id, mixed_case_id]


def test_manual_results_reject_non_manual_cases_and_track_attachments_and_staleness(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        group_id, _, manual_case_id = _manual_group(client)
        auto_case_id = next(
            item["id"]
            for item in client.get(f"/api/test-groups/{group_id}").json()["source_test_cases"]
            if item["case_number"] == "SRC-AUTO"
        )
        rejected = client.post(
            f"/api/test-groups/{group_id}/manual-test-result-batches",
            json={"results": [{"source_test_case_id": auto_case_id, "status": "passed"}]},
        )
        assert rejected.status_code == 422

        batch = client.post(
            f"/api/test-groups/{group_id}/manual-test-result-batches",
            json={"results": [{"source_test_case_id": manual_case_id, "status": "blocked"}]},
        ).json()
        updated = client.put(
            f"/api/manual-test-result-batches/{batch['id']}",
            json={
                "results": [
                    {
                        "source_test_case_id": manual_case_id,
                        "status": "failed",
                        "attachments": [
                            {
                                "filename": "appearance.txt",
                                "content_type": "text/plain",
                                "content_base64": "bm90IG9r",
                            }
                        ],
                    }
                ]
            },
        )
        result = updated.json()["results"][0]
        attachment = result["attachments"][0]
        assert attachment["filename"] == "appearance.txt"
        assert attachment["size_bytes"] == 6
        assert attachment["storage_status"] == "stored"
        assert attachment["usage_status"] == "unused"
        assert client.get(f"/api/manual-test-attachments/{attachment['id']}/download").content == b"not ok"
        group_impact = client.get(f"/api/test-groups/{group_id}/deletion-impact").json()
        assert group_impact["manual_test_result_batches"] == 1
        assert group_impact["manual_test_results"] == 1
        assert group_impact["manual_test_result_attachments"] == 1
        version_impact = client.get(f"/api/product-versions/{batch['product_version_id']}/deletion-impact").json()
        assert version_impact["asset_counts"]["manual_test_result_batches"] == 1
        assert version_impact["asset_counts"]["manual_test_results"] == 1
        assert version_impact["asset_counts"]["manual_test_result_attachments"] == 1

        assert client.delete(f"/api/manual-test-results/{result['id']}").status_code == 204
        with open_database() as connection:
            assert connection.execute("SELECT COUNT(*) FROM manual_test_result_attachments").fetchone()[0] == 0
            events = connection.execute(
                "SELECT event_type, test_group_id FROM report_staleness_events ORDER BY id"
            ).fetchall()
        assert [(row["event_type"], row["test_group_id"]) for row in events] == [
            ("manual_result_updated", group_id),
            ("manual_result_deleted", group_id),
        ]


def test_manual_result_migration_keeps_the_existing_v23_database_usable(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with open_database() as connection:
        connection.execute(
            """INSERT INTO projects (name, product_name, description, created_at, updated_at)
            VALUES ('Atlas', 'Camera', '', 'now', 'now')"""
        )
        connection.execute(
            """INSERT INTO product_versions (project_id, version, name, description, created_at, updated_at)
            VALUES (1, 'EVT1', '', '', 'now', 'now')"""
        )
        connection.execute(
            """INSERT INTO source_test_cases (product_version_id, case_number, title, created_at)
            VALUES (1, 'SRC-1', '外观', 'now')"""
        )
        connection.execute(
            """INSERT INTO test_groups (product_version_id, name, created_at, updated_at)
            VALUES (1, '回归', 'now', 'now')"""
        )
        connection.execute(
            "INSERT INTO test_group_source_cases (test_group_id, source_test_case_id, position) VALUES (1, 1, 1)"
        )
        connection.executescript(
            """
            DROP TABLE report_staleness_events;
            DROP TABLE manual_test_result_attachments;
            DROP TABLE manual_test_results;
            DROP TABLE manual_test_result_batches;
            DELETE FROM schema_migrations WHERE version = 24;
            DELETE FROM schema_migrations WHERE version = 25;
            PRAGMA user_version = 23;
            """
        )

    with open_database() as connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        tables = {
            row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        }

    assert version == 25
    assert {"manual_test_result_batches", "manual_test_results", "manual_test_result_attachments"} <= tables
    with open_database() as connection:
        assert connection.execute("SELECT case_number FROM source_test_cases WHERE id = 1").fetchone()[0] == "SRC-1"
        connection.execute(
            """INSERT INTO manual_test_result_batches
            (test_group_id, product_version_id, batch_number, created_at, updated_at)
            VALUES (1, 1, 1, 'now', 'now')"""
        )
        connection.execute(
            """INSERT INTO manual_test_results
            (manual_test_result_batch_id, source_test_case_id, status, created_at, updated_at)
            VALUES (1, 1, 'passed', 'now', 'now')"""
        )
        connection.execute("DELETE FROM test_groups WHERE id = 1")
        assert connection.execute("SELECT COUNT(*) FROM manual_test_results").fetchone()[0] == 0
