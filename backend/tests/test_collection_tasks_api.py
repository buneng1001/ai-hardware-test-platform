import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def test_engineer_can_create_and_reopen_quick_normal_collection_task(client):
    create_response = client.post(
        "/api/collection-tasks",
        json={"name": "面试快速正常采集", "mode": "quick", "scenario": "normal"},
    )

    assert create_response.status_code == 201
    created_task = create_response.json()
    assert created_task["id"] > 0
    assert created_task["name"] == "面试快速正常采集"
    assert created_task["mode"] == "quick"
    assert created_task["scenario"] == "normal"
    assert created_task["status"] == "draft"

    detail_response = client.get(f"/api/collection-tasks/{created_task['id']}")

    assert detail_response.status_code == 200
    assert detail_response.json() == created_task


def test_saved_collection_task_remains_visible_in_task_list(client):
    created_task = client.post(
        "/api/collection-tasks",
        json={"name": "刷新后仍可查看", "mode": "quick", "scenario": "normal"},
    ).json()

    list_response = client.get("/api/collection-tasks")

    assert list_response.status_code == 200
    assert list_response.json() == [created_task]


def test_quick_and_standard_modes_resolve_to_safe_repeatable_presets(client):
    quick = client.post(
        "/api/collection-tasks",
        json={"name": "快速预设", "mode": "quick", "scenario": "normal"},
    ).json()
    standard = client.post(
        "/api/collection-tasks",
        json={"name": "标准预设", "mode": "standard", "scenario": "normal"},
    ).json()

    assert (quick["duration_seconds"], quick["video"]["channels"], quick["imu"]["sample_rate_hz"]) == (2, 1, 50)
    assert (standard["duration_seconds"], standard["video"]["channels"], standard["imu"]["sample_rate_hz"]) == (
        5,
        4,
        100,
    )


@pytest.mark.parametrize(
    ("field", "values"),
    [
        ("duration_seconds", [2, 300]),
        ("video.channels", [1, 4]),
        ("video.resolution", ["640x360", "1280x720", "1920x1080"]),
        ("video.fps", [15, 24, 25, 30, 60]),
        ("video.container", ["mp4", "mkv"]),
        ("imu.format", ["csv", "jsonl"]),
        ("imu.sample_rate_hz", [50, 100, 200, 500]),
    ],
)
def test_custom_configuration_accepts_each_specified_boundary_and_enum(client, field, values):
    for index, value in enumerate(values):
        payload = _custom_payload(f"合法参数 {field} {index}")
        target = payload
        parts = field.split(".")
        for part in parts[:-1]:
            target = target[part]
        target[parts[-1]] = value

        response = client.post("/api/collection-tasks", json=payload)

        assert response.status_code == 201, response.text


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("duration_seconds", 1),
        ("duration_seconds", 301),
        ("video.channels", 0),
        ("video.channels", 5),
        ("video.resolution", "800x600"),
        ("video.fps", 29),
        ("video.container", "avi"),
        ("imu.format", "json"),
        ("imu.sample_rate_hz", 400),
        ("random_seed", -1),
        ("random_seed", 2_147_483_648),
    ],
)
def test_custom_configuration_rejects_values_outside_the_spec(client, field, value):
    payload = _custom_payload(f"非法参数 {field}")
    target = payload
    parts = field.split(".")
    for part in parts[:-1]:
        target = target[part]
    target[parts[-1]] = value

    response = client.post("/api/collection-tasks", json=payload)

    assert response.status_code == 422


def _custom_payload(name):
    return {
        "name": name,
        "mode": "custom",
        "scenario": "normal",
        "duration_seconds": 2,
        "video": {"channels": 1, "resolution": "640x360", "fps": 15, "container": "mp4"},
        "imu": {"format": "csv", "sample_rate_hz": 50},
        "random_seed": 0,
    }


@pytest.mark.parametrize(
    ("payload", "expected_error"),
    [
        ({"name": "   ", "mode": "quick", "scenario": "normal"}, "任务名称不能为空"),
        ({"name": "缺参数", "mode": "custom", "scenario": "normal"}, "自定义模式必须提供完整数据参数"),
        ({"name": "错误场景", "mode": "quick", "scenario": "video_drop"}, "当前只支持正常采集场景"),
    ],
)
def test_invalid_collection_task_is_rejected_without_being_saved(client, payload, expected_error):
    invalid_response = client.post(
        "/api/collection-tasks",
        json=payload,
    )

    assert invalid_response.status_code == 422
    assert expected_error in invalid_response.text
    assert client.get("/api/collection-tasks").json() == []
