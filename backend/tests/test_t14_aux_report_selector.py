"""T14: main-report exclusion and server-side auxiliary selection admission."""

import json

import pytest
from fastapi.testclient import TestClient

from app.database import open_database
from app.main import app
from tests.test_t13_report_source_snapshot import _batch, _create_group, _report


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REPORT_ANALYSIS_MODE", "disabled")
    with TestClient(app) as test_client:
        yield test_client


def test_t14_options_and_validation(client):
    project, version, group = _create_group(client)
    _, batch = _batch(client, version, group, "passed")
    main_source = _report(client, group, automation_execution_id=None, manual_batch_ids=[batch]).json()
    second_same_version = _report(client, group, automation_execution_id=None, manual_batch_ids=[batch]).json()
    _, version2, group2 = _create_group(client, project_id=project, version="EVT2")
    _, batch2 = _batch(client, version2, group2, "failed")
    eligible = _report(client, group2, automation_execution_id=None, manual_batch_ids=[batch2]).json()
    embedded = _report(
        client, group2, automation_execution_id=None, manual_batch_ids=[], historical_report_ids=[main_source["id"]]
    ).json()
    _, _, group3 = _create_group(client, project_id=project, version="EVT3")
    main = _report(
        client, group3, automation_execution_id=None, manual_batch_ids=[], historical_report_ids=[main_source["id"]]
    ).json()
    _, foreign_version, foreign_group = _create_group(client, version="FOREIGN")
    _, foreign_batch = _batch(client, foreign_version, foreign_group, "passed")
    foreign = _report(client, foreign_group, automation_execution_id=None, manual_batch_ids=[foreign_batch]).json()

    endpoint = f"/api/fact-reports/{main['id']}/regression-auxiliary"
    options = client.get(endpoint + "-options")
    assert options.status_code == 200, options.text
    ids = [item["id"] for item in options.json()["items"]]
    assert ids == sorted(ids, reverse=True)
    assert set(ids) == {second_same_version["id"], eligible["id"], embedded["id"]}
    assert main_source["id"] not in ids
    assert main["id"] not in ids
    assert foreign["id"] not in ids
    assert all("analysis_status" in item for item in options.json()["items"])

    def check(ids, status=422):
        response = client.post(endpoint + "-validation", json={"report_ids": ids})
        assert response.status_code == status, response.text
        return response

    assert check([], 200).json() == {"report_ids": []}
    assert check([eligible["id"], second_same_version["id"]], 200).json()["report_ids"] == [
        eligible["id"],
        second_same_version["id"],
    ]
    for invalid in (
        [main["id"]],
        [main_source["id"]],
        [foreign["id"]],
        [eligible["id"], eligible["id"]],
        [9999999],
        [-1],
    ):
        check(invalid)

    with open_database() as connection:
        connection.execute(
            "UPDATE online_reports SET snapshot = ? WHERE id = ?", (json.dumps({"broken": True}), eligible["id"])
        )
    check([eligible["id"]])
    assert eligible["id"] not in [item["id"] for item in client.get(endpoint + "-options").json()["items"]]
