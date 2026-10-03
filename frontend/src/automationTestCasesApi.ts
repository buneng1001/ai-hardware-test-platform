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
  conversion_status: "candidate" | "failed" | "manual";
  confidence: "low";
  review_note: string;
  validation_status: "unvalidated" | "passed" | "failed";
  validation_message: string;
  feedback_input: string;
  feedback_status: "not_requested" | "unavailable" | "accepted";
  feedback_response: string;
  created_at: string;
  updated_at: string;
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

export type AutomationTestCaseDraft = Pick<
  AutomationTestCase,
  "title" | "input" | "steps" | "expected_result"
>;

export type AutomationCaseHistory = {
  source: Record<string, string>;
  items: Array<{
    id: number;
    event_type: string;
    snapshot: Record<string, unknown>;
    created_at: string;
  }>;
};

export function createAutomationTestCase(
  versionId: number,
  command: AutomationTestCaseDraft & { source_case_number: string },
) {
  return request<AutomationTestCase>(
    `/api/product-versions/${versionId}/automation-test-cases`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    },
  );
}

export function updateAutomationTestCase(
  versionId: number,
  caseId: number,
  command: AutomationTestCaseDraft,
) {
  return request<AutomationTestCase>(
    `/api/product-versions/${versionId}/automation-test-cases/${caseId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    },
  );
}

export function regenerateAutomationTestCase(
  versionId: number,
  caseId: number,
) {
  return request<AutomationTestCase>(
    `/api/product-versions/${versionId}/automation-test-cases/${caseId}/regenerate`,
    { method: "POST" },
  );
}

export function deleteAutomationTestCase(versionId: number, caseId: number) {
  return request<void>(
    `/api/product-versions/${versionId}/automation-test-cases/${caseId}`,
    { method: "DELETE" },
  );
}

export function validateAutomationTestCases(versionId: number) {
  return request<{ valid: boolean; items: AutomationTestCase[] }>(
    `/api/product-versions/${versionId}/automation-test-cases/validate`,
    { method: "POST" },
  );
}

export function submitAutomationCaseFeedback(
  versionId: number,
  caseId: number,
  feedback_input: string,
) {
  return request<void>(
    `/api/product-versions/${versionId}/automation-test-cases/${caseId}/feedback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback_input }),
    },
  );
}

export function getAutomationCaseHistory(versionId: number, caseId: number) {
  return request<AutomationCaseHistory>(
    `/api/product-versions/${versionId}/automation-test-cases/${caseId}/history`,
  );
}
