import { request } from "./apiClient";

export type AutomationTestCase = {
  id: number;
  product_version_id: number;
  source_test_case_id: number;
  source_case_number: string;
  case_number: string;
  title: string;
  input: string;
  steps: string;
  expected_result: string;
  conversion_status: "candidate" | "failed";
  confidence: "low";
  review_note: string;
  created_at: string;
};

export type AutomationCaseConversionBatch = {
  created_count: number;
  items: AutomationTestCase[];
};

export function listAutomationTestCases(versionId: number) {
  return request<{ items: AutomationTestCase[] }>(
    `/api/product-versions/${versionId}/automation-test-cases`,
  );
}

export function convertSourceTestCasesWithRules(versionId: number) {
  return request<AutomationCaseConversionBatch>(
    `/api/product-versions/${versionId}/automation-test-case-conversions/rules`,
    { method: "POST" },
  );
}
