from app.case_services import AutomationCaseConversionResult, AutomationCaseConversionService


class FakeConverter:
    """固定输出的替换实现，证明业务只依赖转换接口而不是具体规则或 Skill。"""

    def convert(self, source_case: dict[str, str]) -> AutomationCaseConversionResult:
        return AutomationCaseConversionResult(
            status="candidate",
            confidence="low",
            review_note=f"fake:{source_case['case_number']}",
            title=source_case["title"],
        )


def test_conversion_service_uses_injected_converter():
    service = AutomationCaseConversionService(FakeConverter())
    result = service.convert({"case_number": "REC-001", "title": "录制"})

    assert result.review_note == "fake:REC-001"
    assert result.title == "录制"
    assert result.confidence == "low"
