import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { AutomationTestCasesPanel } from "./AutomationTestCasesPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const automationCases = {
  created_count: 2,
  items: [
    {
      id: 1,
      product_version_id: 11,
      source_test_case_id: 4,
      source_case_number: "REC-001",
      case_number: "AUTO-000001",
      title: "录制文件完整",
      input: "正常录制数据",
      steps: "开始录制并停止",
      expected_result: "生成完整视频文件",
      conversion_status: "candidate",
      confidence: "low",
      review_note: "规则转换候选，低可信度，需人工审核。",
      created_at: "2026-09-23T00:00:00+00:00",
    },
    {
      id: 2,
      product_version_id: 11,
      source_test_case_id: 5,
      source_case_number: "REC-002",
      case_number: "AUTO-000002",
      title: "",
      input: "",
      steps: "",
      expected_result: "",
      conversion_status: "failed",
      confidence: "low",
      review_note: "缺少测试用例标题",
      created_at: "2026-09-23T00:00:00+00:00",
    },
  ],
};

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("测试工程师可生成低可信度规则候选并从候选表跳回来源用例", async () => {
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/product-versions/11/automation-test-cases") {
        return Promise.resolve(response({ items: [] }));
      }
      if (
        url ===
        "/api/product-versions/11/automation-test-case-conversions/rules"
      ) {
        expect(init?.method).toBe("POST");
        return Promise.resolve(response(automationCases, 201));
      }
      return Promise.reject(new Error(`未预期请求：${url}`));
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<AutomationTestCasesPanel productVersionId={11} />);
  expect(await screen.findByText("还没有自动化用例候选")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "规则转换原始用例" }));

  expect(await screen.findByText("AUTO-000001")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "REC-001" })).toHaveAttribute(
    "href",
    "#source-test-case-4",
  );
  expect(screen.getByText("低可信度候选")).toBeInTheDocument();
  expect(screen.getByText("缺少测试用例标题")).toBeInTheDocument();
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/product-versions/11/automation-test-case-conversions/rules",
      { method: "POST" },
    ),
  );
});
