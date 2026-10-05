import { jsonHeaders, request } from "./apiClient";

export type FactReport = {
  id: number;
  test_group_id: number;
  product_version_id: number;
  automation_execution_id: number | null;
  manual_batch_ids: number[];
  created_at: string;
  lifecycle_status: "current" | "stale" | "superseded";
  attachment_summary: ReportAttachmentSummary;
  snapshot: {
    warnings: string[];
    stage_progress: { conclusion: string; basis: string[] };
    ai_analysis: { status: string; message: string };
  };
  analysis: ReportAnalysis;
};

export type ReportAttachment = {
  id: number | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_status: "stored" | "cleaned";
  usage_status: "used";
};

export type ReportAttachmentSummary = {
  attachment_count: number;
  total_size_bytes: number;
  attachments: ReportAttachment[];
};

export type ReportAttachmentCleanupImpact = ReportAttachmentSummary & {
  report_id: number;
  message: string;
};

export type ReportHistoryItem = {
  record_type: "automation_execution" | "manual_result" | "fact_report";
  id: number;
  label: string;
  status: string;
  occurred_at: string;
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

export function getReportHistory(groupId: number, query = "") {
  const suffix = query ? `?query=${encodeURIComponent(query)}` : "";
  return request<{ items: ReportHistoryItem[] }>(
    `/api/test-groups/${groupId}/report-history${suffix}`,
  );
}

export function getReportAttachmentCleanupImpact(reportId: number) {
  return request<ReportAttachmentCleanupImpact>(
    `/api/fact-reports/${reportId}/attachment-cleanup-impact`,
  );
}

export function cleanupReportUsedAttachments(reportId: number) {
  return request<void>(
    `/api/fact-reports/${reportId}/used-attachments?confirm=true`,
    { method: "DELETE" },
  );
}

export function deleteFactReport(reportId: number) {
  return request<void>(`/api/fact-reports/${reportId}`, { method: "DELETE" });
}
