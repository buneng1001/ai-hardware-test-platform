from app.case_services import RequirementPointAnalysisService, TestCaseGenerationService


def test_requirement_and_case_generation_services_are_explicitly_disabled():
    requirement_result = RequirementPointAnalysisService().analyze({"title": "录制需求"})
    case_result = TestCaseGenerationService().generate({"requirement_id": "REQ-1"})

    assert requirement_result == {"status": "disabled", "message": "未启用", "items": []}
    assert case_result == {"status": "disabled", "message": "未启用", "items": []}
