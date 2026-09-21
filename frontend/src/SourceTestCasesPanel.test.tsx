import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { SourceTestCasesPanel } from "./SourceTestCasesPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const preview = {
  source_filename: "beta.csv",
  field_mapping: { case_number: "用例编号", title: "测试用例标题" },
  rows: [
    {
      用例编号: "REC-001",
      测试用例标题: "录制文件完整",
      模块: "录制",
      输入: "",
    },
  ],
  import_options: {},
};

const importedCase = {
  id: 1,
  import_record_id: 1,
  source_import_status: "active",
  case_number: "REC-001",
  title: "录制文件完整",
  priority: "",
  preconditions: "",
  input: "",
  steps: "",
  expected_result: "",
  test_type: "",
  module: "录制",
  test_item: "",
  test_result: "",
  test_record: "",
  pre_test_notes: "",
  planned_execution_time: "",
  attachment: "",
  software_version: "",
  selected: false,
};

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("测试工程师可确认字段映射、导入、筛选并恢复原始用例勾选", async () => {
  let imported = false;
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/preview?")) return Promise.resolve(response(preview));
    if (url === "/api/product-versions/11/source-test-case-imports") {
      if (!imported) {
        imported = true;
        return Promise.resolve(
          response(
            {
              id: 1,
              product_version_id: 11,
              source_filename: "beta.csv",
              field_mapping: preview.field_mapping,
              import_options: {
                include_historical_results: false,
                include_test_records: false,
                include_pre_test_notes: false,
                include_planned_execution_time: false,
                include_attachments: false,
              },
              imported_at: "2026-09-21T08:00:00Z",
            },
            201,
          ),
        );
      }
      return Promise.resolve(response([]));
    }
    if (url.startsWith("/api/product-versions/11/source-test-cases?")) {
      return Promise.resolve(
        response({ items: imported ? [importedCase] : [] }),
      );
    }
    if (url === "/api/product-versions/11/source-test-case-selection") {
      return Promise.resolve(response({ source_test_case_ids: [1] }));
    }
    return Promise.reject(new Error(`未预期请求：${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<SourceTestCasesPanel productVersionId={11} />);
  await screen.findByText("还没有原始测试用例");

  const file = new File(["ignored"], "beta.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("选择 Beta 测试用例文件"), {
    target: { files: [file] },
  });

  expect(await screen.findByText("确认字段映射")).toBeInTheDocument();
  expect(screen.getByLabelText("用例编号映射")).toHaveValue("用例编号");
  expect(screen.getByLabelText("输入映射")).toHaveValue("");
  fireEvent.click(screen.getByLabelText("导入历史测试结果"));
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));

  expect(await screen.findByText("REC-001")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("选择 REC-001"));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/product-versions/11/source-test-case-selection",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ source_test_case_ids: [1] }),
      }),
    ),
  );
});
