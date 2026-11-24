import pytest
from fastapi.testclient import TestClient
from test_test_groups_api import _create_version_with_cases

from app.database import open_database
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def test_reverse_relation_exact_version_and_read_only(client):
    version, source_ids = _create_version_with_cases(client)
    other_version, _ = _create_version_with_cases(client, "Other Atlas")
    base = f"/api/product-versions/{version}"
    automation = client.post(f"{base}/automation-test-case-conversions/rules").json()["items"]
    assert client.post(f"{base}/automation-test-cases/validate").json()["valid"]
    group = client.post(f"{base}/test-groups", json={"name": "T23"}).json()
    case = automation[0]
    assert (
        client.post(
            f"/api/test-groups/{group['id']}/automation-test-cases", json={"case_ids": [case["id"]]}
        ).status_code
        == 200
    )

    def snapshot():
        with open_database() as connection:
            tables = (
                "source_test_cases",
                "automation_test_cases",
                "test_group_source_cases",
                "test_group_automation_cases",
                "test_group_data_package_assignments",
            )
            return {
                table: [tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY rowid")]
                for table in tables
            }

    before = snapshot()
    url = f"{base}/automation-test-cases/{case['id']}/source-relation"
    assert client.get(url).json() == {"source_test_case_id": source_ids[0], "product_version_id": version}
    detail = client.get(f"/api/test-groups/{group['id']}").json()
    assert detail["automation_test_cases"][0]["source_test_case_id"] == source_ids[0]
    bad = client.get(f"/api/product-versions/{other_version}/automation-test-cases/{case['id']}/source-relation")
    assert bad.status_code == 404
    assert bad.json() == {"detail": "来源用例不可用"}
    assert client.get(f"{base}/automation-test-cases/999999/source-relation").status_code == 404
    assert snapshot() == before
