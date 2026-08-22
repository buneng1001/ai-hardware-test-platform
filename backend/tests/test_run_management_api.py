import time

from fastapi.testclient import TestClient

from app.main import app

TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}


def wait_for_status(client: TestClient, run_id: int, statuses: set[str], timeout: float = 10) -> dict:
    """只通过公开查询接口等待状态，避免测试依赖执行器内部实现。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in statuses:
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 未在 {timeout} 秒内进入 {statuses}")


def wait_for_retained_artifacts(client: TestClient, run_id: int, timeout: float = 10) -> dict:
    """取消立即生效后，等待当前生成步骤完成安全收尾并保留证据。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "cancelled" and run["artifacts"]:
            return run
        time.sleep(0.01)
    raise AssertionError(f"运行 #{run_id} 取消后未在 {timeout} 秒内保留已生成证据")


def create_task(client: TestClient) -> dict:
    response = client.post(
        "/api/collection-tasks",
        json={"name": "队列管理任务", "mode": "quick", "scenario": "normal"},
    )
    assert response.status_code == 201
    return response.json()


def test_runs_are_queued_and_completed_one_at_a_time(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = create_task(client)
        first = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        second = client.post(f"/api/collection-tasks/{task['id']}/runs").json()

        assert second["status"] == "queued"
        first_completed = wait_for_status(client, first["id"], {"completed"})
        second_completed = wait_for_status(client, second["id"], {"completed"})

    first_completed_at = first_completed["completed_at"]
    second_started_at = next(
        event["occurred_at"] for event in second_completed["events"] if event["stage"] == "generating_data"
    )
    assert second_started_at >= first_completed_at


def test_engineer_can_cancel_queued_and_executing_runs_without_losing_generated_evidence(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = create_task(client)
        executing = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        queued = client.post(f"/api/collection-tasks/{task['id']}/runs").json()

        cancelled_queued = client.post(f"/api/runs/{queued['id']}/cancel")
        assert cancelled_queued.status_code == 200
        assert cancelled_queued.json()["status"] == "cancelled"

        wait_for_status(client, executing["id"], {"generating_data"})
        cancelled_executing = client.post(f"/api/runs/{executing['id']}/cancel")
        assert cancelled_executing.status_code == 200
        final_executing = wait_for_retained_artifacts(client, executing["id"])

    assert final_executing["artifacts"]
    assert final_executing["completed_at"] is not None


def test_rerun_creates_a_new_record_and_snapshot_without_overwriting_history(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = create_task(client)
        original = client.post(f"/api/collection-tasks/{task['id']}/runs").json()
        original = wait_for_status(client, original["id"], TERMINAL_STATUSES)
        rerun_response = client.post(f"/api/runs/{original['id']}/rerun")

        assert rerun_response.status_code == 201
        rerun = wait_for_status(client, rerun_response.json()["id"], TERMINAL_STATUSES)
        reopened_original = client.get(f"/api/runs/{original['id']}").json()

    assert rerun["id"] != original["id"]
    assert rerun["collection_task_id"] == original["collection_task_id"]
    assert rerun["configuration_snapshot"] == original["configuration_snapshot"]
    assert reopened_original == original


def test_restart_marks_unfinished_run_as_interrupted(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))

    with TestClient(app) as client:
        task = create_task(client)
        unfinished = client.post(f"/api/collection-tasks/{task['id']}/runs").json()

    with TestClient(app) as restarted_client:
        recovered = restarted_client.get(f"/api/runs/{unfinished['id']}").json()

    assert recovered["status"] == "interrupted"
    assert recovered["completed_at"] is not None
    assert recovered["error"] == "应用重启时检测到未完成运行"
