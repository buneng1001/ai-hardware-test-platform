import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { FrontendRoot } from "../FrontendRoot";
import type { AutomationExecution } from "../automationExecutionsApi";
import type { FactReport, ReportHistoryItem } from "../factReportsApi";
import type {
  ManualTestResultBatch,
  ManualTestResultPage,
} from "../manualTestResultsApi";
import { projectSummary, productVersion } from "./casesFixtures";
import { jsonResponse } from "./testHttp";
import { groupSummary, testGroupDetail } from "./testGroupFixtures";

export function factReport(overrides: Partial<FactReport> = {}): FactReport {
  return {
    id: 5,
    test_group_id: 21,
    product_version_id: 11,
    automation_execution_id: 3,
    manual_batch_ids: [1],
    created_at: "2026-10-30T10:00:00+00:00",
    lifecycle_status: "current",
    attachment_summary: {
      attachment_count: 0,
      total_size_bytes: 0,
      attachments: [],
    },
    snapshot: {
      basic_information: {
        project_name: "IRIS",
        product_name: "Recorder",
        product_version: "EVT1",
        test_group: "EVT1 基础回归",
        generated_at: "2026-10-30T10:00:00+00:00",
        contains: "自动化和人工结果",
        automation_execution: {
          id: 3,
          execution_number: 3,
          status: "completed",
          execution_mode: "data_driven_simulation",
          started_at: "2026-10-30T09:00:00+00:00",
          completed_at: "2026-10-30T09:00:10+00:00",
        },
        manual_batches: [
          { id: 1, batch_number: 1, created_at: "2026-10-30T09:30:00+00:00" },
        ],
      },
      warnings: [],
      stage_progress: {
        conclusion: "建议暂缓并补充验证",
        basis: ["失败 1 项"],
      },
      ai_analysis: {
        status: "not_configured",
        message: "AI 未配置；事实报告已按确定性记录生成。",
      },
      scope_overview: {
        original_case_count: 2,
        module_count: 1,
        automation_case_count: 1,
        manual_case_count: 1,
        counts: { passed: 0, failed: 1, blocked: 0, not_executed: 1 },
      },
      modules: [
        {
          name: "采集",
          conclusion: "建议暂缓并补充验证",
          counts: { passed: 0, failed: 1, blocked: 0, not_executed: 1 },
          records: [
            {
              case_number: "SRC-001",
              title: "录制",
              module: "采集",
              test_item: "录制",
              source: "自动化",
              status: "failed",
              message: "确定性检查实际结果：video_drop；未满足用例预期。",
              executed_at: null,
            },
          ],
        },
      ],
      cross_module_issues: [],
    },
    analysis: {
      status: "not_configured",
      message: "AI 分析未启用",
      output: null,
    },
    ...overrides,
  };
}

export function reportHistoryItem(
  id: number,
  status = "current",
  occurredAt = "2026-10-30T10:00:00+00:00",
): ReportHistoryItem {
  return {
    record_type: "fact_report",
    id,
    label: `最终报告 #${id}`,
    status,
    occurred_at: occurredAt,
  };
}

export type ReportStubState = {
  groups: ReturnType<typeof testGroupDetail>[];
  executions: AutomationExecution[];
  cases: ManualTestResultPage["cases"];
  batches: ManualTestResultBatch[];
  history: ReportHistoryItem[];
  reports: Record<number, FactReport>;
  createdReport?: FactReport;
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
        return jsonResponse({ items: state.history });
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
      const reportMatch = url.match(/^\/api\/fact-reports\/(\d+)$/);
      if (reportMatch && method === "GET") {
        const report = state.reports[Number(reportMatch[1])];
        return report
          ? jsonResponse(report)
          : jsonResponse({ detail: "事实报告不存在" }, 404);
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
