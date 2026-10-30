import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { FrontendRoot } from "../FrontendRoot";
import type {
  AutomationExecution,
  PreparationCheck,
} from "../automationExecutionsApi";
import { projectSummary, productVersion } from "./casesFixtures";
import { jsonResponse } from "./testHttp";
import { groupSummary, testGroupDetail } from "./testGroupFixtures";

export function executionRecord(
  overrides: Partial<AutomationExecution> = {},
): AutomationExecution {
  return {
    id: 1,
    test_group_id: 21,
    product_version_id: 11,
    execution_number: 1,
    status: "completed",
    execution_mode: "data_driven_simulation",
    started_at: "2026-10-30T08:00:00+00:00",
    completed_at: "2026-10-30T08:00:05+00:00",
    summary: { passed: 1, failed: 0, blocked: 0, not_executed: 0 },
    group_snapshot: {
      name: "EVT1 基础回归",
      product_version: "EVT1",
      test_group_id: 21,
    },
    configuration_snapshot: {
      execution_mode: "data_driven_simulation",
      checker_version: "v0.2.0-rc.1",
    },
    case_results: [
      {
        automation_test_case_id: 1,
        case_number: "AUTO-000001",
        title: "录制检查",
        position: 1,
        status: "passed",
        message: "确定性数据检查结果符合用例预期。",
      },
    ],
    ...overrides,
  };
}

export type ExecutionStubState = {
  groups: ReturnType<typeof testGroupDetail>[];
  executions: AutomationExecution[];
  preparation?: { passed: boolean; checks: PreparationCheck[] };
  nextExecution?: AutomationExecution;
  failRecordsTimes?: number;
};

export function stubExecutionApi(state: ExecutionStubState) {
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
      if (url.startsWith("/api/product-versions/11/test-groups?")) {
        return jsonResponse({
          items: state.groups.map(groupSummary),
          page: 1,
          page_size: 20,
          total: state.groups.length,
        });
      }
      const recordsMatch = url.match(
        /^\/api\/test-groups\/(\d+)\/automation-executions$/,
      );
      if (recordsMatch && method === "GET") {
        if ((state.failRecordsTimes ?? 0) > 0) {
          state.failRecordsTimes = (state.failRecordsTimes ?? 0) - 1;
          return jsonResponse({ detail: "执行记录服务暂时不可用" }, 500);
        }
        const groupId = Number(recordsMatch[1]);
        return jsonResponse({
          items: state.executions.filter(
            (item) => item.test_group_id === groupId,
          ),
        });
      }
      const startMatch = url.match(
        /^\/api\/test-groups\/(\d+)\/automation-executions(\/cancelled|\/interrupted)?$/,
      );
      if (startMatch && method === "POST") {
        const groupId = Number(startMatch[1]);
        const previous = Math.max(
          0,
          ...state.executions
            .filter((item) => item.test_group_id === groupId)
            .map((item) => item.execution_number),
        );
        const terminal = startMatch[2]?.replace("/", "") ?? "completed";
        const record =
          state.nextExecution ??
          executionRecord({
            id: 100 + previous,
            test_group_id: groupId,
            execution_number: previous + 1,
            status: terminal,
            ...(terminal === "completed"
              ? {}
              : {
                  summary: {
                    passed: 0,
                    failed: 0,
                    blocked: 0,
                    not_executed: 1,
                  },
                  case_results: [
                    {
                      automation_test_case_id: 1,
                      case_number: "AUTO-000001",
                      title: "录制检查",
                      position: 1,
                      status: "not_executed" as const,
                      message: "执行在该用例开始前已取消或中断。",
                    },
                  ],
                }),
          });
        state.executions = [record, ...state.executions];
        return jsonResponse(record, 201);
      }
      const preparationMatch = url.match(
        /^\/api\/test-groups\/(\d+)\/automation-execution-preparations$/,
      );
      if (preparationMatch && method === "POST") {
        const groupId = Number(preparationMatch[1]);
        return jsonResponse(
          state.preparation ?? {
            test_group_id: groupId,
            passed: true,
            checks: [],
          },
        );
      }
      const executionMatch = url.match(/^\/api\/automation-executions\/(\d+)$/);
      if (executionMatch) {
        const record = state.executions.find(
          (item) => item.id === Number(executionMatch[1]),
        );
        return record
          ? jsonResponse(record)
          : jsonResponse({ detail: "自动化执行记录不存在" }, 404);
      }
      return jsonResponse({ detail: "未模拟的接口" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 进入冻结版工作区的“执行与结果”页签。 */
export async function openResultsView() {
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
