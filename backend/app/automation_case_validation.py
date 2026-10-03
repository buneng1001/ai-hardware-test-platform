from app.automation_test_case_models import AutomationTestCase


def validation_message(case: AutomationTestCase) -> str:
    """确定性校验只检查可执行资产的身份、来源和必填内容。"""
    errors: list[str] = []
    if not case.case_number.startswith("AUTO-"):
        errors.append("自动化编号无效")
    if not case.source_case_number.strip():
        errors.append("来源编号无效")
    if not case.title.strip():
        errors.append("标题不能为空")
    if not case.steps.strip():
        errors.append("操作步骤不能为空")
    if not case.expected_result.strip():
        errors.append("预期结果不能为空")
    return "；".join(errors)
