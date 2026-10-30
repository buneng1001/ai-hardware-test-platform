import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { FrontendRoot } from "../FrontendRoot";
import type { AutomationExecution } from "../automationExecutionsApi";
import type {
  ManualTestAttachment,
  ManualTestResult,
  ManualTestResultBatch,
  ManualTestResultPage,
  ManualTestStatus,
} from "../manualTestResultsApi";
import { projectSummary, productVersion } from "./casesFixtures";
import { jsonResponse } from "./testHttp";
import { groupSummary, testGroupDetail } from "./testGroupFixtures";

export function manualCase(
  id: number,
  caseNumber: string,
  title: string,
  testType = "manual",
): ManualTestResultPage["cases"][number] {
  return {
    id,
    case_number: caseNumber,
    title,
    test_type: testType,
    position: 1,
  };
}

export function manualAttachment(
  id: number,
  filename: string,
  overrides: Partial<ManualTestAttachment> = {},
): ManualTestAttachment {
  return {
    id,
    filename,
    content_type: "image/png",
    size_bytes: 12,
    sha256: "sha",
    storage_status: "stored",
    usage_status: "unused",
    ...overrides,
  };
}

export function manualResult(
  id: number,
  sourceCaseId: number,
  overrides: Partial<ManualTestResult> = {},
): ManualTestResult {
  return {
    id,
    source_test_case_id: sourceCaseId,
    status: "passed",
    actual_result: "实际结果",
    notes: "备注",
    executed_at: null,
    created_at: "2026-10-30T09:00:00+00:00",
    updated_at: "2026-10-30T09:00:00+00:00",
    attachments: [],
    ...overrides,
  };
}

export function manualBatch(
  id: number,
  batchNumber: number,
  results: ManualTestResult[],
): ManualTestResultBatch {
  return {
    id,
    test_group_id: 21,
    product_version_id: 11,
    batch_number: batchNumber,
    created_at: "2026-10-30T09:00:00+00:00",
    updated_at: "2026-10-30T09:00:00+00:00",
    results,
  };
}

export type ManualStubState = {
  groups: ReturnType<typeof testGroupDetail>[];
  cases: ManualTestResultPage["cases"];
  batches: ManualTestResultBatch[];
  executions?: AutomationExecution[];
  failTimes?: number;
  nextId?: number;
};

export function stubManualApi(state: ManualStubState) {
  const nextId = () => {
    state.nextId = (state.nextId ?? 100) + 1;
    return state.nextId;
  };
  const saveResults = (
    batch: ManualTestResultBatch,
    commands: Array<{
      source_test_case_id: number;
      status: ManualTestStatus;
      actual_result: string | null;
      notes: string | null;
      executed_at: string | null;
      attachments?: Array<{ filename: string; content_type: string }>;
    }>,
  ) => {
    for (const command of commands) {
      const existing = batch.results.find(
        (item) => item.source_test_case_id === command.source_test_case_id,
      );
      const attachments = (command.attachments ?? []).map((item) =>
        manualAttachment(nextId(), item.filename),
      );
      if (existing) {
        Object.assign(existing, {
          status: command.status,
          actual_result: command.actual_result,
          notes: command.notes,
          executed_at: command.executed_at,
          attachments: [...existing.attachments, ...attachments],
        });
      } else {
        batch.results.push(
          manualResult(nextId(), command.source_test_case_id, {
            status: command.status,
            actual_result: command.actual_result,
            notes: command.notes,
            executed_at: command.executed_at,
            attachments,
          }),
        );
      }
    }
    batch.updated_at = "2026-10-30T10:00:00+00:00";
    return batch;
  };

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
        return jsonResponse({ items: state.executions ?? [] });
      if (
        url === "/api/test-groups/21/manual-test-result-batches" &&
        method === "GET"
      ) {
        if ((state.failTimes ?? 0) > 0) {
          state.failTimes = (state.failTimes ?? 0) - 1;
          return jsonResponse({ detail: "人工结果服务暂时不可用" }, 500);
        }
        return jsonResponse({
          test_group_id: 21,
          product_version_id: 11,
          cases: state.cases,
          batches: state.batches,
        });
      }
      if (
        url === "/api/test-groups/21/manual-test-result-batches" &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body)) as {
          results: Array<{
            source_test_case_id: number;
            status: ManualTestStatus;
            actual_result: string | null;
            notes: string | null;
            executed_at: string | null;
            attachments?: Array<{ filename: string; content_type: string }>;
          }>;
        };
        const number =
          Math.max(0, ...state.batches.map((item) => item.batch_number)) + 1;
        const batch = saveResults(
          manualBatch(nextId(), number, []),
          body.results,
        );
        state.batches = [batch, ...state.batches];
        return jsonResponse(batch, 201);
      }
      const batchMatch = url.match(
        /^\/api\/manual-test-result-batches\/(\d+)$/,
      );
      if (batchMatch && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as {
          results: Array<{
            source_test_case_id: number;
            status: ManualTestStatus;
            actual_result: string | null;
            notes: string | null;
            executed_at: string | null;
            attachments?: Array<{ filename: string; content_type: string }>;
          }>;
        };
        const batch = state.batches.find(
          (item) => item.id === Number(batchMatch[1]),
        );
        if (!batch) return jsonResponse({ detail: "批次不存在" }, 404);
        state.batches = state.batches.map((item) =>
          item.id === batch.id ? saveResults(batch, body.results) : item,
        );
        return jsonResponse(batch);
      }
      const resultMatch = url.match(/^\/api\/manual-test-results\/(\d+)$/);
      if (resultMatch && method === "DELETE") {
        const resultId = Number(resultMatch[1]);
        state.batches = state.batches.map((batch) => ({
          ...batch,
          results: batch.results.filter((item) => item.id !== resultId),
        }));
        return new Response(null, { status: 204 });
      }
      const attachmentMatch = url.match(
        /^\/api\/manual-test-attachments\/(\d+)$/,
      );
      if (attachmentMatch && method === "DELETE") {
        const attachmentId = Number(attachmentMatch[1]);
        state.batches = state.batches.map((batch) => ({
          ...batch,
          results: batch.results.map((result) => ({
            ...result,
            attachments: result.attachments.filter(
              (item) => item.id !== attachmentId,
            ),
          })),
        }));
        return new Response(null, { status: 204 });
      }
      if (/\/report-history$/.test(url)) return jsonResponse({ items: [] });
      return jsonResponse({ detail: "未模拟的接口" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 从“执行与结果”进入人工结果录入页。 */
export async function openManualView() {
  render(<FrontendRoot />);
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));
  fireEvent.click(await screen.findByRole("button", { name: "执行与结果" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "进入人工结果录入" }),
  );
  await screen.findByRole("heading", { name: "逐条录入人工测试" });
}

export function callsOf(
  fetchMock: ReturnType<typeof vi.fn>,
): Array<[RequestInfo | URL, RequestInit | undefined]> {
  return fetchMock.mock.calls as unknown as Array<
    [RequestInfo | URL, RequestInit | undefined]
  >;
}
