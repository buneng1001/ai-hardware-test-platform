import { jsonHeaders, request } from "./apiClient";

export const sourceCaseFields = [
  ["case_number", "用例编号"],
  ["title", "测试用例标题"],
  ["priority", "优先级"],
  ["preconditions", "预置条件"],
  ["input", "输入"],
  ["steps", "操作步骤"],
  ["expected_result", "预期结果"],
  ["test_type", "测试类型"],
  ["module", "模块"],
  ["test_item", "测试项"],
  ["test_result", "测试结果"],
  ["test_record", "测试记录"],
  ["pre_test_notes", "测试前备注信息"],
  ["planned_execution_time", "计划执行时间"],
  ["attachment", "附件"],
  ["software_version", "软件版本"],
] as const;

export type SourceCaseField = (typeof sourceCaseFields)[number][0];
export type ImportOptions = {
  include_historical_results: boolean;
  include_test_records: boolean;
  include_pre_test_notes: boolean;
  include_planned_execution_time: boolean;
  include_attachments: boolean;
};
export type SourceTestCaseImportDraft = {
  source_filename: string;
  field_mapping: Partial<Record<SourceCaseField, string>>;
  rows: Array<Record<string, string>>;
  import_options: Partial<ImportOptions>;
};
export type SourceTestCase = {
  id: number;
  import_record_id: number | null;
  source_import_status: "active" | "import_deleted";
  case_number: string;
  title: string;
  priority: string;
  preconditions: string;
  input: string;
  steps: string;
  expected_result: string;
  test_type: string;
  module: string;
  test_item: string;
  test_result: string;
  test_record: string;
  pre_test_notes: string;
  planned_execution_time: string;
  attachment: string;
  software_version: string;
  selected: boolean;
};
export type SourceTestCaseImportRecord = {
  id: number;
  product_version_id: number;
  source_filename: string;
  field_mapping: Record<string, string>;
  import_options: ImportOptions;
  imported_at: string;
};
export type ImportDeletionImpact = {
  import_record_id: number;
  source_test_cases: number;
  automation_test_cases: number;
  message: string;
};

export function previewSourceTestCaseImport(versionId: number, file: File) {
  return request<SourceTestCaseImportDraft>(
    `/api/product-versions/${versionId}/source-test-case-imports/preview?filename=${encodeURIComponent(file.name)}`,
    { method: "POST", body: file },
  );
}

export function createSourceTestCaseImport(
  versionId: number,
  command: SourceTestCaseImportDraft,
) {
  return request<SourceTestCaseImportRecord>(
    `/api/product-versions/${versionId}/source-test-case-imports`,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify(command) },
  );
}

export function listSourceTestCases(
  versionId: number,
  filters: Record<string, string>,
) {
  const query = new URLSearchParams(filters);
  return request<{ items: SourceTestCase[] }>(
    `/api/product-versions/${versionId}/source-test-cases?${query.toString()}`,
  );
}

export function replaceSourceTestCaseSelection(
  versionId: number,
  sourceTestCaseIds: number[],
) {
  return request<{ source_test_case_ids: number[] }>(
    `/api/product-versions/${versionId}/source-test-case-selection`,
    {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ source_test_case_ids: sourceTestCaseIds }),
    },
  );
}

export function listSourceTestCaseImports(versionId: number) {
  return request<SourceTestCaseImportRecord[]>(
    `/api/product-versions/${versionId}/source-test-case-imports`,
  );
}

export function getImportDeletionImpact(importId: number) {
  return request<ImportDeletionImpact>(
    `/api/source-test-case-imports/${importId}/deletion-impact`,
  );
}

export function deleteSourceTestCaseImport(importId: number) {
  return request<void>(
    `/api/source-test-case-imports/${importId}?confirm=true`,
    {
      method: "DELETE",
    },
  );
}
