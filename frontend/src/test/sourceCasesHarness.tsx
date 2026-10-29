import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { FrontendRoot } from "../FrontendRoot";
import type {
  ImportDeletionImpact,
  ImportOptions,
  SourceTestCase,
  SourceTestCaseImportDraft,
  SourceTestCaseImportRecord,
} from "../sourceTestCasesApi";

const projectSummary = {
  id: 1,
  name: "IRIS 头环",
  product_name: "多传感器记录设备",
  description: "Beta 测试项目",
  product_version_count: 1,
  created_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-02T08:00:00Z",
};

const productVersion = {
  id: 11,
  project_id: 1,
  version: "EVT1",
  name: "",
  description: "",
  created_at: "2026-10-01T08:10:00Z",
  updated_at: "2026-10-01T08:10:00Z",
};

const defaultImportOptions: ImportOptions = {
  include_historical_results: false,
  include_test_records: false,
  include_pre_test_notes: false,
  include_planned_execution_time: false,
  include_attachments: false,
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 构造一条完整原始用例，测试只覆盖当前断言需要的字段差异。 */
export function sourceCase(overrides: Partial<SourceTestCase>): SourceTestCase {
  return {
    id: 1,
    import_record_id: 1,
    source_import_status: "active",
    case_number: "REC-001",
    title: "录制文件完整",
    priority: "高",
    preconditions: "",
    input: "",
    steps: "确认设备处于待机状态",
    expected_result: "",
    test_type: "",
    module: "录制功能",
    test_item: "文件完整性",
    test_result: "",
    test_record: "",
    pre_test_notes: "",
    planned_execution_time: "",
    attachment: "",
    software_version: "EVT1-0.2.0",
    selected: false,
    ...overrides,
  };
}

export function importRecord(
  overrides: Partial<SourceTestCaseImportRecord> = {},
): SourceTestCaseImportRecord {
  return {
    id: 7,
    product_version_id: 11,
    source_filename: "beta.csv",
    field_mapping: { case_number: "用例编号", title: "测试用例标题" },
    import_options: defaultImportOptions,
    imported_at: "2026-10-29T10:00:00+00:00",
    ...overrides,
  };
}

export type StubState = {
  cases: SourceTestCase[];
  records: SourceTestCaseImportRecord[];
  preview?: SourceTestCaseImportDraft;
  impact?: ImportDeletionImpact;
  failSourceTimes?: number;
};

function importOptionsOf(draft: SourceTestCaseImportDraft): ImportOptions {
  return {
    include_historical_results:
      draft.import_options.include_historical_results ?? false,
    include_test_records: draft.import_options.include_test_records ?? false,
    include_pre_test_notes:
      draft.import_options.include_pre_test_notes ?? false,
    include_planned_execution_time:
      draft.import_options.include_planned_execution_time ?? false,
    include_attachments: draft.import_options.include_attachments ?? false,
  };
}

/** 模拟项目、趋势和原始用例接口，测试不访问真实后端。 */
export function stubApi(state: StubState) {
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
      if (url.startsWith("/api/product-versions/11/source-test-cases")) {
        if ((state.failSourceTimes ?? 0) > 0) {
          state.failSourceTimes = (state.failSourceTimes ?? 0) - 1;
          return jsonResponse({ detail: "数据库暂时不可用" }, 500);
        }
        const query = new URL(url, "http://local").searchParams;
        const fields = [
          "module",
          "test_item",
          "priority",
          "software_version",
        ] as const;
        const items = state.cases.filter((item) =>
          fields.every((field) => {
            const value = query.get(field);
            return !value || item[field] === value;
          }),
        );
        return jsonResponse({ items });
      }
      if (
        url === "/api/product-versions/11/source-test-case-imports" &&
        method === "GET"
      )
        return jsonResponse(state.records);
      if (
        url.startsWith(
          "/api/product-versions/11/source-test-case-imports/preview",
        ) &&
        method === "POST"
      )
        return jsonResponse(state.preview);
      if (
        url === "/api/product-versions/11/source-test-case-imports" &&
        method === "POST"
      ) {
        const command = JSON.parse(
          String(init?.body),
        ) as SourceTestCaseImportDraft;
        const record = importRecord({
          id: 9,
          source_filename: command.source_filename,
          field_mapping: command.field_mapping as Record<string, string>,
          import_options: importOptionsOf(command),
        });
        state.records = [record, ...state.records];
        return jsonResponse(record, 201);
      }
      if (url.endsWith("/source-test-case-selection") && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as {
          source_test_case_ids: number[];
        };
        state.cases = state.cases.map((item) => ({
          ...item,
          selected: body.source_test_case_ids.includes(item.id),
        }));
        return jsonResponse({
          source_test_case_ids: body.source_test_case_ids,
        });
      }
      if (url.endsWith("/deletion-impact") && method === "GET")
        return jsonResponse(state.impact);
      if (
        url.startsWith("/api/source-test-case-imports/") &&
        method === "DELETE"
      ) {
        state.cases = state.cases.map((item) => ({
          ...item,
          source_import_status: "import_deleted",
          import_record_id: null,
        }));
        state.records = [];
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ detail: "未模拟的接口" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 进入冻结版工作区的“需求 / 测试用例”页签。 */
export async function openCasesTab() {
  render(<FrontendRoot />);
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: "需求 / 测试用例" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "测试用例表" }));
}

/** 进入“测试用例表”并等待真实数据加载完成。 */
export async function openSourceView() {
  await openCasesTab();
  await screen.findByRole("button", { name: "导入用例表" });
}

export function callsOf(
  fetchMock: ReturnType<typeof vi.fn>,
): Array<[RequestInfo | URL, RequestInit | undefined]> {
  return fetchMock.mock.calls as unknown as Array<
    [RequestInfo | URL, RequestInit | undefined]
  >;
}

/** 取出所有勾选保存请求的用例 ID，用于验证持久化顺序。 */
export function selectionBodies(
  fetchMock: ReturnType<typeof vi.fn>,
): number[][] {
  return callsOf(fetchMock)
    .filter(
      ([input, init]) =>
        String(input).endsWith("/source-test-case-selection") &&
        init?.method === "PUT",
    )
    .map(
      ([, init]) =>
        (
          JSON.parse(String(init?.body)) as {
            source_test_case_ids: number[];
          }
        ).source_test_case_ids,
    );
}
