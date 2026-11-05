"""AI 判定式自动化用例转换：只把模型判为 automation 的用例落成候选。"""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app


class DecisionAdapter:
    """按用例编号后缀决定判定结果，模拟模型返回结构化输出。"""

    max_calls = 40

    def __init__(self) -> None:
        self.calls = 0

    def generate_json(
        self,
        *,
        api_key: str,
        model: str,
        evidence_json: str,
        system_prompt: str,
        prompt_version: str = "",
        stage: str = "",
    ) -> dict[str, object]:
        self.calls += 1
        cases = json.loads(evidence_json)["cases"]
        items = []
        for case in cases:
            manual = str(case["case_number"]).startswith("MANUAL")
            items.append(
                {
                    "source_case_id": case["source_case_id"],
                    "decision": "manual" if manual else "automation",
                    "reason": "依赖人工观察" if manual else "输入和预期可确定性校验",
                    "title": f"{case['title']}（AI 改写）",
                    "input": case["input"],
                    "steps": case["steps"],
                    "expected_result": case["expected_result"],
                    "confidence": "high" if not manual else "medium",
                }
            )
        return {"items": items}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SILICONFLOW_API_KEY", "test-key")
    with TestClient(app) as test_client:
        yield test_client


def create_version_with_source_cases(client: TestClient) -> int:
    project = client.post(
        "/api/projects",
        json={"name": "IRIS", "product_name": "Recorder", "description": ""},
    ).json()
    version_id = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT1"}).json()["id"]
    imported = client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={
            "source_filename": "beta.csv",
            "field_mapping": {
                "case_number": "编号",
                "title": "标题",
                "input": "输入",
                "steps": "步骤",
                "expected_result": "预期",
            },
            "rows": [
                {
                    "编号": "REC-001",
                    "标题": "录制文件完整",
                    "输入": "正常录制数据",
                    "步骤": "开始录制并停止",
                    "预期": "生成完整视频文件",
                },
                {
                    "编号": "MANUAL-002",
                    "标题": "外观检查",
                    "输入": "",
                    "步骤": "目视检查外壳",
                    "预期": "无明显划痕",
                },
            ],
            "import_options": {},
        },
    )
    assert imported.status_code == 201
    return version_id


def test_ai_conversion_only_creates_candidates_for_automation_decisions(client, monkeypatch):
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _provider: adapter)
    version_id = create_version_with_source_cases(client)

    converted = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={})

    assert converted.status_code == 201
    body = converted.json()
    assert body["automation_count"] == 1
    assert body["manual_count"] == 1
    assert body["created_count"] == 1
    assert [item["source_case_number"] for item in body["items"]] == ["REC-001"]
    assert body["items"][0]["title"] == "录制文件完整（AI 改写）"
    manual = [item for item in body["decisions"] if item["decision"] == "manual"][0]
    assert manual["case_number"] == "MANUAL-002"
    assert manual["reason"] == "依赖人工观察"
    # 转人工的用例不应出现在自动化用例表里。
    listed = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]
    assert [item["source_case_number"] for item in listed] == ["REC-001"]


def test_ai_conversion_is_idempotent_for_already_converted_cases(client, monkeypatch):
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _provider: adapter)
    version_id = create_version_with_source_cases(client)

    client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={})
    second = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={})

    assert second.status_code == 201
    assert second.json()["created_count"] == 0
    assert adapter.calls == 1


def test_ai_conversion_requires_configured_key(client, monkeypatch):
    monkeypatch.delenv("SILICONFLOW_API_KEY", raising=False)
    version_id = create_version_with_source_cases(client)

    response = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/ai", json={})

    assert response.status_code == 400
    assert "AI 模型" in response.json()["detail"]


def test_ai_conversion_rejudges_selected_cases_and_removes_manual_candidates(client, monkeypatch):
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _provider: adapter)
    version_id = create_version_with_source_cases(client)
    # 先跑规则转换：两条都先变成自动化候选，模拟用户已经点过一次旧按钮。
    rules = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules").json()
    assert rules["created_count"] == 2
    ids = [item["id"] for item in client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]]

    converted = client.post(
        f"/api/product-versions/{version_id}/automation-test-case-conversions/ai",
        json={"source_case_ids": ids},
    ).json()

    assert converted["automation_count"] == 1
    assert converted["manual_count"] == 1
    assert converted["created_count"] == 0
    assert converted["updated_count"] == 1
    assert converted["removed_count"] == 1
    listed = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]
    assert [item["source_case_number"] for item in listed] == ["REC-001"]
    case_types = {
        item["case_number"]: item["case_type"]
        for item in client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
    }
    assert case_types == {"REC-001": "automation", "MANUAL-002": "manual"}


def test_unknown_ai_stage_falls_back_to_business_timeout(monkeypatch):
    """新增的转换阶段没有单独超时配置时，按业务请求超时处理而不是抛 KeyError。"""
    from app.ai_provider_core import configured_timeout

    monkeypatch.delenv("AI_BUSINESS_TIMEOUT_SECONDS", raising=False)

    assert configured_timeout("automation_conversion") == 600.0


def test_import_can_use_current_product_version_instead_of_imported_column(client):
    project = client.post("/api/projects", json={"name": "IRIS", "product_name": "Recorder", "description": ""}).json()
    version_id = client.post(f"/api/projects/{project['id']}/product-versions", json={"version": "EVT2"}).json()["id"]

    client.post(
        f"/api/product-versions/{version_id}/source-test-case-imports",
        json={
            "source_filename": "beta.csv",
            "field_mapping": {"case_number": "编号", "title": "标题", "software_version": "版本"},
            "rows": [{"编号": "REC-001", "标题": "录制", "版本": "EVT0"}],
            "import_options": {},
            "software_version_source": "current",
        },
    )

    cases = client.get(f"/api/product-versions/{version_id}/source-test-cases").json()["items"]
    assert cases[0]["software_version"] == "EVT2"


def test_ai_conversion_mode_all_rejudges_existing_candidates(client, monkeypatch):
    """mode=all 会把已有自动化用例一起重判，判为人工的会被移除。"""
    adapter = DecisionAdapter()
    monkeypatch.setattr("app.automation_conversion_ai.get_provider_adapter", lambda _provider: adapter)
    version_id = create_version_with_source_cases(client)
    rules = client.post(f"/api/product-versions/{version_id}/automation-test-case-conversions/rules").json()
    assert rules["created_count"] == 2

    # 默认 missing 模式此时没有可处理的用例。
    skipped = client.post(
        f"/api/product-versions/{version_id}/automation-test-case-conversions/ai",
        json={"mode": "missing"},
    ).json()
    assert skipped["decisions"] == []

    rejudged = client.post(
        f"/api/product-versions/{version_id}/automation-test-case-conversions/ai",
        json={"mode": "all"},
    ).json()
    assert rejudged["automation_count"] == 1
    assert rejudged["manual_count"] == 1
    assert rejudged["removed_count"] == 1
    listed = client.get(f"/api/product-versions/{version_id}/automation-test-cases").json()["items"]
    assert [item["source_case_number"] for item in listed] == ["REC-001"]
