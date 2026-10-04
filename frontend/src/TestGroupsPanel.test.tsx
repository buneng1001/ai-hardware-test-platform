import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { TestGroupsPanel } from "./TestGroupsPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const detail = {
  id: 4,
  product_version_id: 11,
  name: "基础回归",
  description: "",
  hidden: false,
  source_test_case_count: 1,
  automation_test_case_count: 1,
  data_package_assignment_count: 0,
  created_at: "2026-10-04T00:00:00+00:00",
  updated_at: "2026-10-04T00:00:00+00:00",
  source_test_cases: [
    {
      id: 1,
      case_number: "SRC-1",
      title: "录制",
      test_type: "manual",
      software_version: "EVT1",
      position: 1,
    },
  ],
  automation_test_cases: [
    {
      id: 2,
      case_number: "AUTO-000002",
      source_case_number: "SRC-1",
      title: "录制检查",
      validation_status: "passed",
      source_software_version: "EVT1",
      position: 1,
      data_packages: [],
    },
  ],
};

test("测试工程师可打开测试组详情并在用例表逐条关联已校验数据包", async () => {
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/product-versions/11/test-groups?"))
        return Promise.resolve(
          response({ items: [detail], page: 1, page_size: 20, total: 1 }),
        );
      if (url === "/api/test-groups/4")
        return Promise.resolve(response(detail));
      if (url === "/api/test-groups/4/automation-executions")
        return Promise.resolve(response({ items: [] }));
      if (url === "/api/product-versions/11/automation-test-cases")
        return Promise.resolve(response({ items: [] }));
      if (url === "/api/product-versions/11/source-test-cases?")
        return Promise.resolve(response({ items: [] }));
      if (url === "/api/data-packages")
        return Promise.resolve(
          response({
            items: [
              {
                id: 7,
                package_number: "DP-000007",
                validation_status: "passed",
              },
            ],
          }),
        );
      if (
        url === "/api/test-groups/4/automation-test-cases/2/data-packages" &&
        init?.method === "PUT"
      )
        return Promise.resolve(
          response({
            ...detail,
            data_package_assignment_count: 1,
            automation_test_cases: [
              {
                ...detail.automation_test_cases[0],
                data_packages: [
                  {
                    id: 7,
                    package_number: "DP-000007",
                    validation_status: "passed",
                    has_newer_source_result: false,
                    recommended_source_run_id: null,
                    warnings: [],
                  },
                ],
              },
            ],
          }),
        );
      return Promise.reject(new Error(`未预期请求：${url}`));
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<TestGroupsPanel productVersionId={11} />);
  fireEvent.click(await screen.findByRole("button", { name: "基础回归" }));
  const select = await screen.findByLabelText("AUTO-000002 数据包");
  const option = (await within(select).findByRole("option", {
    name: "DP-000007",
  })) as HTMLOptionElement;
  option.selected = true;
  fireEvent.change(select);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/test-groups/4/automation-test-cases/2/data-packages",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ data_package_ids: [7] }),
      }),
    ),
  );
  expect(await screen.findByText("数据包关联已更新。")).toBeInTheDocument();
});

test("测试工程师先完成准备检查，再从测试组创建数据驱动模拟执行记录", async () => {
  const execution = {
    id: 9,
    test_group_id: 4,
    execution_number: 1,
    status: "completed",
    started_at: "2026-10-04T00:00:00+00:00",
    completed_at: "2026-10-04T00:00:01+00:00",
    summary: { passed: 1, failed: 0, blocked: 0, not_executed: 0 },
    group_snapshot: { name: "基础回归" },
    case_results: [
      {
        automation_test_case_id: 2,
        case_number: "AUTO-000002",
        title: "录制检查",
        position: 1,
        status: "passed",
        message: "已完成数据包完整性与确定性检查。",
      },
    ],
  };
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/product-versions/11/test-groups?"))
        return Promise.resolve(
          response({ items: [detail], page: 1, page_size: 20, total: 1 }),
        );
      if (url === "/api/test-groups/4")
        return Promise.resolve(response(detail));
      if (url === "/api/product-versions/11/automation-test-cases")
        return Promise.resolve(response({ items: [] }));
      if (url === "/api/product-versions/11/source-test-cases?")
        return Promise.resolve(response({ items: [] }));
      if (url === "/api/data-packages")
        return Promise.resolve(response({ items: [] }));
      if (url === "/api/test-groups/4/automation-executions") {
        return Promise.resolve(
          init?.method === "POST"
            ? response(execution, 201)
            : response({ items: [] }),
        );
      }
      if (
        url === "/api/test-groups/4/automation-execution-preparations" &&
        init?.method === "POST"
      ) {
        return Promise.resolve(response({ passed: true, checks: [] }));
      }
      return Promise.reject(new Error(`未预期请求：${url}`));
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<TestGroupsPanel productVersionId={11} />);
  fireEvent.click(await screen.findByRole("button", { name: "基础回归" }));
  fireEvent.click(await screen.findByRole("button", { name: "开始准备检查" }));
  fireEvent.click(await screen.findByRole("button", { name: "开始执行" }));

  expect(await screen.findByText("自动化执行 #1 已完成。")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/test-groups/4/automation-executions",
    expect.objectContaining({ method: "POST" }),
  );
});
