import { jsonHeaders, request } from "./apiClient";

export type FactReport = {
  id: number;
  test_group_id: number;
  product_version_id: number;
  automation_execution_id: number | null;
  manual_batch_ids: number[];
  created_at: string;
  snapshot: {
    warnings: string[];
    stage_progress: { conclusion: string; basis: string[] };
    ai_analysis: { status: string; message: string };
  };
};

export function createFactReport(
  groupId: number,
  input: { automation_execution_id: number | null; manual_batch_ids: number[] },
) {
  return request<FactReport>(`/api/test-groups/${groupId}/fact-reports`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
}
