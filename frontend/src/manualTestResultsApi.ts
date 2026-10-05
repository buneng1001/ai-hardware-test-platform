import { jsonHeaders, request } from "./apiClient";

export type ManualTestStatus = "passed" | "failed" | "blocked" | "not_executed";

export const manualTestStatusLabels: Record<ManualTestStatus, string> = {
  passed: "通过",
  failed: "失败",
  blocked: "阻塞",
  not_executed: "未执行",
};

export type ManualTestAttachment = {
  id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  storage_status: "stored" | "cleaned";
  usage_status: "unused" | "used";
};

export type ManualTestResult = {
  id: number;
  source_test_case_id: number;
  status: ManualTestStatus;
  actual_result: string | null;
  notes: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
  attachments: ManualTestAttachment[];
};

export type ManualTestResultBatch = {
  id: number;
  test_group_id: number;
  product_version_id: number;
  batch_number: number;
  created_at: string;
  updated_at: string;
  results: ManualTestResult[];
};

export type ManualTestResultPage = {
  test_group_id: number;
  product_version_id: number;
  cases: Array<{
    id: number;
    case_number: string;
    title: string;
    test_type: string;
    position: number;
  }>;
  batches: ManualTestResultBatch[];
};

export type ManualTestResultCommand = {
  source_test_case_id: number;
  status: ManualTestStatus;
  actual_result: string | null;
  notes: string | null;
  executed_at: string | null;
  attachments?: Array<{
    filename: string;
    content_type: string;
    content_base64: string;
  }>;
};

export function getManualTestResultPage(groupId: number) {
  return request<ManualTestResultPage>(
    `/api/test-groups/${groupId}/manual-test-result-batches`,
  );
}

export function createManualTestResultBatch(
  groupId: number,
  results: ManualTestResultCommand[],
) {
  return request<ManualTestResultBatch>(
    `/api/test-groups/${groupId}/manual-test-result-batches`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ results }),
    },
  );
}

export function saveManualTestResultBatch(
  batchId: number,
  results: ManualTestResultCommand[],
) {
  return request<ManualTestResultBatch>(
    `/api/manual-test-result-batches/${batchId}`,
    {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ results }),
    },
  );
}

export function deleteManualTestResult(resultId: number) {
  return request<void>(`/api/manual-test-results/${resultId}`, {
    method: "DELETE",
  });
}

export function deleteManualTestAttachment(attachmentId: number) {
  return request<void>(`/api/manual-test-attachments/${attachmentId}`, {
    method: "DELETE",
  });
}
