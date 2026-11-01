import { sourceCaseFields, type SourceCaseField } from "./sourceTestCasesApi";

/**
 * 平台默认的测试用例表模板：与产品确认过的 12 列。
 * 模板只影响界面展示和后续导入映射的预填，不改变后端已支持的字段集合。
 */
export const DEFAULT_CASE_TEMPLATE_FIELDS: SourceCaseField[] = [
  "case_number",
  "title",
  "priority",
  "preconditions",
  "input",
  "steps",
  "expected_result",
  "test_type",
  "module",
  "test_item",
  "attachment",
  "software_version",
];

/** 取字段的中文列名；找不到时回退为字段 key。 */
export function caseFieldLabel(field: SourceCaseField): string {
  const matched = sourceCaseFields.find(([key]) => key === field);
  return matched ? matched[1] : field;
}

/** 默认模板的列名列表，保持模板定义的顺序。 */
export function defaultTemplateHeaders(): string[] {
  return DEFAULT_CASE_TEMPLATE_FIELDS.map(caseFieldLabel);
}
