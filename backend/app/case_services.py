"""v0.2.0 用例生成能力边界及其确定性实现。"""

from dataclasses import dataclass
from typing import Any, Protocol


class RequirementPointAnalysisService:
    """明确关闭的需求点分析服务，避免导入流程伪造需求资产。"""

    def analyze(self, _material: dict[str, Any]) -> dict[str, object]:
        return {"status": "disabled", "message": "未启用", "items": []}


class TestCaseGenerationService:
    """明确关闭的测试用例生成服务，v0.2.0 不从需求生成用例。"""

    def generate(self, _requirement: dict[str, Any]) -> dict[str, object]:
        return {"status": "disabled", "message": "未启用", "items": []}


@dataclass(frozen=True)
class AutomationCaseConversionResult:
    """转换实现和持久化层之间的统一候选结构。"""

    status: str
    confidence: str
    review_note: str
    title: str = ""
    input: str = ""
    steps: str = ""
    expected_result: str = ""


class RuleBasedAutomationCaseConverter:
    """离线规则：保留已有内容，并为可安全补全的字段提供最小候选。"""

    def convert(self, source_case: dict[str, str]) -> AutomationCaseConversionResult:
        case_number = source_case["case_number"].strip()
        title = source_case["title"].strip()
        if not case_number:
            return AutomationCaseConversionResult("failed", "low", "缺少来源用例编号")
        if not title:
            return AutomationCaseConversionResult("failed", "low", "缺少测试用例标题")
        return AutomationCaseConversionResult(
            status="candidate",
            confidence="low",
            review_note="规则转换候选，低可信度，需人工审核。",
            title=title,
            input=source_case["input"].strip(),
            steps=source_case["steps"].strip() or f"执行原始用例 {case_number}：{title}",
            expected_result=source_case["expected_result"].strip() or f"确认“{title}”符合原始用例预期。",
        )


class AutomationCaseConverter(Protocol):
    def convert(self, source_case: dict[str, str]) -> AutomationCaseConversionResult: ...


class AutomationCaseConversionService:
    """业务调用的稳定边界；后续可替换规则、Skill 或模型适配器。"""

    def __init__(self, converter: AutomationCaseConverter | None = None) -> None:
        self._converter = converter or RuleBasedAutomationCaseConverter()

    def convert(self, source_case: dict[str, str]) -> AutomationCaseConversionResult:
        return self._converter.convert(source_case)
