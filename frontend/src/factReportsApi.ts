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
  analysis: ReportAnalysis;
};

export type ReportAnalysis = {
  status: string;
  message: string;
  output: {
    risks: { content: string; evidence_refs: string[] }[];
    additional_verifications: { content: string; evidence_refs: string[] }[];
    regression_recommendations: { content: string; evidence_refs: string[] }[];
    stage_recommendation: {
      suggestion: string;
      content: string;
      evidence_refs: string[];
    };
  } | null;
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

export function retryFactReportAnalysis(reportId: number) {
  return request<ReportAnalysis>(`/api/fact-reports/${reportId}/analysis`, {
    method: "POST",
  });
}

export function getFactReport(reportId: number) {
  return request<FactReport>(`/api/fact-reports/${reportId}`);
}
