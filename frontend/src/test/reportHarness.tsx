import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { FrontendRoot } from "../FrontendRoot";
import type { AutomationExecution } from "../automationExecutionsApi";
import type {
  FactReport,
  ReportAnalysis,
  ReportAttachmentCleanupImpact,
  ReportHistoryItem,
} from "../factReportsApi";
import type {
  ManualTestResultBatch,
  ManualTestResultPage,
} from "../manualTestResultsApi";
import { projectSummary, productVersion } from "./casesFixtures";
import { jsonResponse } from "./testHttp";
import { groupSummary, testGroupDetail } from "./testGroupFixtures";

import {
  completedAnalysis,
  factReport,
  reportHistoryItem,
} from "./reportFixtures";
export {
  completedAnalysis,
  factReport,
  reportAttachmentSummary,
  reportHistoryItem,
} from "./reportFixtures";

export type ReportStubState = {
  groups: ReturnType<typeof testGroupDetail>[];
  executions: AutomationExecution[];
  cases: ManualTestResultPage["cases"];
  batches: ManualTestResultBatch[];
  history: ReportHistoryItem[];
  reports: Record<number, FactReport>;
  createdReport?: FactReport;
  analysisResult?: ReportAnalysis;
  cleanupImpact?: ReportAttachmentCleanupImpact;
  failHistoryTimes?: number;
};

export function stubReportApi(state: ReportStubState) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/projects?"))
        return jsonResponse([projectSummary]);
      if (url === "/api/projects/1")
        return jsonResponse({
          ...projectSummary,
          product_versions: [productVersion],
        });
      if (url === "/api/projects/1/trends")
        return jsonResponse({
          project_id: 1,
          status: "empty",
          message: "尚无最终报告",
          points: [],
        });
      if (url.startsWith("/api/product-versions/11/test-groups?"))
        return jsonResponse({
          items: state.groups.map(groupSummary),
          page: 1,
          page_size: 20,
          total: state.groups.length,
        });
      if (url === "/api/test-groups/21/automation-executions")
        return jsonResponse({ items: state.executions });
      if (url === "/api/test-groups/21/manual-test-result-batches")
        return jsonResponse({
          test_group_id: 21,
          product_version_id: 11,
          cases: state.cases,
          batches: state.batches,
        });
      const historyMatch = url.match(
        /^\/api\/test-groups\/21\/report-history(\?.*)?$/,
      );
      if (historyMatch && method === "GET") {
        if ((state.failHistoryTimes ?? 0) > 0) {
          state.failHistoryTimes = (state.failHistoryTimes ?? 0) - 1;
          return jsonResponse({ detail: "报告服务暂时不可用" }, 500);
        }
        const query = new URL(url, "http://local").searchParams.get("query");
        const term = (query ?? "").trim().toLowerCase();
        return jsonResponse({
          items: term
            ? state.history.filter(
                (item) =>
                  item.label.toLowerCase().includes(term) ||
                  item.status.toLowerCase().includes(term),
              )
            : state.history,
        });
      }
      if (url === "/api/test-groups/21/fact-reports" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          automation_execution_id: number | null;
          manual_batch_ids: number[];
        };
        const created =
          state.createdReport ??
          factReport({
            id: 9,
            automation_execution_id: body.automation_execution_id,
            manual_batch_ids: body.manual_batch_ids,
          });
        state.createdReport = created;
        state.reports[created.id] = created;
        state.history = [
          reportHistoryItem(created.id),
          ...state.history.filter((item) => item.id !== created.id),
        ];
        return jsonResponse(created, 201);
      }
      const impactMatch = url.match(
        /^\/api\/fact-reports\/(\d+)\/attachment-cleanup-impact$/,
      );
      if (impactMatch && method === "GET") {
        const report = state.reports[Number(impactMatch[1])];
        return jsonResponse(
          state.cleanupImpact ?? {
            report_id: Number(impactMatch[1]),
            attachment_count: report?.attachment_summary.attachment_count ?? 0,
            total_size_bytes: report?.attachment_summary.total_size_bytes ?? 0,
            attachments: report?.attachment_summary.attachments ?? [],
            message:
              "确认后将仅清理当前报告已使用附件的原始文件；人工文字结果和附件名称会保留。",
          },
        );
      }
      const cleanupMatch = url.match(
        /^\/api\/fact-reports\/(\d+)\/used-attachments\?confirm=true$/,
      );
      if (cleanupMatch && method === "DELETE") {
        const reportId = Number(cleanupMatch[1]);
        const report = state.reports[reportId];
        if (report) {
          state.reports[reportId] = {
            ...report,
            attachment_summary: {
              ...report.attachment_summary,
              attachments: report.attachment_summary.attachments.map(
                (item) => ({ ...item, storage_status: "cleaned" as const }),
              ),
            },
          };
        }
        return new Response(null, { status: 204 });
      }
      const deleteMatch = url.match(/^\/api\/fact-reports\/(\d+)$/);
      if (deleteMatch && method === "DELETE") {
        const reportId = Number(deleteMatch[1]);
        delete state.reports[reportId];
        state.history = state.history.filter(
          (item) =>
            !(item.record_type === "fact_report" && item.id === reportId),
        );
        return new Response(null, { status: 204 });
      }
      const reportMatch = url.match(/^\/api\/fact-reports\/(\d+)$/);
      if (reportMatch && method === "GET") {
        const report = state.reports[Number(reportMatch[1])];
        return report
          ? jsonResponse(report)
          : jsonResponse({ detail: "事实报告不存在" }, 404);
      }
      const analysisMatch = url.match(/^\/api\/fact-reports\/(\d+)\/analysis$/);
      if (analysisMatch && method === "POST") {
        const reportId = Number(analysisMatch[1]);
        const analysis = state.analysisResult ?? completedAnalysis();
        const current = state.reports[reportId];
        if (current) {
          state.reports[reportId] = { ...current, analysis };
        }
        return jsonResponse(analysis, 201);
      }
      return jsonResponse({ detail: "未模拟的接口" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 进入冻结版工作区的“执行与结果”页签。 */
export async function openReportView() {
  render(<FrontendRoot />);
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));
  fireEvent.click(await screen.findByRole("button", { name: "执行与结果" }));
  await screen.findByRole("heading", { name: "自动化结果与最终报告" });
}

export function callsOf(
  fetchMock: ReturnType<typeof vi.fn>,
): Array<[RequestInfo | URL, RequestInit | undefined]> {
  return fetchMock.mock.calls as unknown as Array<
    [RequestInfo | URL, RequestInit | undefined]
  >;
}
