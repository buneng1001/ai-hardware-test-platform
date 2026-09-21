"""v0.3.0 前预留的需求与测试用例生成能力边界。"""

from typing import Any


class RequirementPointAnalysisService:
    """明确关闭的需求点分析服务，避免导入流程伪造需求资产。"""

    def analyze(self, _material: dict[str, Any]) -> dict[str, object]:
        return {"status": "disabled", "message": "未启用", "items": []}


class TestCaseGenerationService:
    """明确关闭的测试用例生成服务，v0.2.0 不从需求生成用例。"""

    def generate(self, _requirement: dict[str, Any]) -> dict[str, object]:
        return {"status": "disabled", "message": "未启用", "items": []}
