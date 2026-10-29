import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { SourceTestCaseImportDraft } from "./sourceTestCasesApi";
import {
  callsOf,
  openCasesTab,
  openSourceView,
  selectionBodies,
  sourceCase,
  stubApi,
} from "./test/sourceCasesHarness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("测试用例表加载真实数据并恢复已保存的勾选清单", async () => {
  stubApi({
    cases: [
      sourceCase({ id: 1, case_number: "REC-001", selected: true }),
      sourceCase({
        id: 2,
        case_number: "REC-002",
        title: "断电恢复",
        module: "电源管理",
        priority: "中",
        test_item: "断电检测",
        steps: "在设备录制过程中断开电源",
        selected: false,
      }),
    ],
    records: [],
  });
  await openCasesTab();

  expect(screen.getByText("正在加载原始测试用例…")).toBeVisible();
  expect(
    await screen.findByRole("checkbox", { name: "选择用例 REC-001" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "选择用例 REC-002" }),
  ).not.toBeChecked();
  expect(screen.getByRole("columnheader", { name: "用例编号" })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "测试步骤" })).toBeVisible();
  expect(screen.getByText(/当前勾选 1 条/)).toBeVisible();
});

test("筛选、全选、反选和勾选都会按产品版本保存选择清单", async () => {
  const fetchMock = stubApi({
    cases: [
      sourceCase({ id: 1, case_number: "REC-001" }),
      sourceCase({
        id: 2,
        case_number: "POWER-002",
        title: "断电恢复",
        module: "电源管理",
        test_item: "断电检测",
      }),
    ],
    records: [],
  });
  await openSourceView();

  fireEvent.change(screen.getByRole("combobox", { name: "模块筛选" }), {
    target: { value: "电源管理" },
  });
  await waitFor(() => {
    expect(
      callsOf(fetchMock).some(([input]) => {
        const url = new URL(String(input), "http://local");
        return (
          url.pathname.endsWith("/source-test-cases") &&
          url.searchParams.get("module") === "电源管理"
        );
      }),
    ).toBe(true);
  });
  expect(await screen.findByText("断电恢复")).toBeVisible();
  expect(screen.queryByText("录制文件完整")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "全选当前筛选结果" }));
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: "选择用例 POWER-002" }),
    ).toBeChecked(),
  );

  fireEvent.click(screen.getByRole("button", { name: "反选当前筛选结果" }));
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: "选择用例 POWER-002" }),
    ).not.toBeChecked(),
  );

  fireEvent.click(screen.getByRole("checkbox", { name: "选择用例 POWER-002" }));
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: "选择用例 POWER-002" }),
    ).toBeChecked(),
  );

  expect(selectionBodies(fetchMock)).toEqual([[2], [], [2]]);
});

test("导入前核对字段映射并选择可选导入范围", async () => {
  const preview: SourceTestCaseImportDraft = {
    source_filename: "beta.csv",
    field_mapping: { case_number: "用例编号", title: "测试用例标题" },
    rows: [{ 用例编号: "REC-009", 测试用例标题: "导入用例" }],
    import_options: {},
  };
  const fetchMock = stubApi({
    cases: [sourceCase({ id: 1 })],
    records: [],
    preview,
  });
  await openSourceView();

  fireEvent.change(screen.getByLabelText("选择 Beta 测试用例文件"), {
    target: {
      files: [
        new File(["用例编号,测试用例标题"], "beta.csv", { type: "text/csv" }),
      ],
    },
  });

  expect(
    await screen.findByRole("heading", { name: "确认字段映射" }),
  ).toBeVisible();
  expect(screen.getByRole("combobox", { name: "用例编号映射" })).toHaveValue(
    "用例编号",
  );
  expect(
    screen.getByRole("combobox", { name: "测试用例标题映射" }),
  ).toHaveValue("测试用例标题");
  const historyOption = screen.getByRole("checkbox", {
    name: "导入历史测试结果",
  });
  expect(historyOption).not.toBeChecked();
  fireEvent.click(historyOption);
  fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));

  await waitFor(() => {
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          String(input) ===
            "/api/product-versions/11/source-test-case-imports" &&
          init?.method === "POST",
      ),
    ).toBe(true);
  });
  const posted = callsOf(fetchMock).find(
    ([input, init]) =>
      String(input) === "/api/product-versions/11/source-test-case-imports" &&
      init?.method === "POST",
  );
  const body = JSON.parse(
    String(posted?.[1]?.body),
  ) as SourceTestCaseImportDraft;
  expect(body.source_filename).toBe("beta.csv");
  expect(body.field_mapping.case_number).toBe("用例编号");
  expect(body.import_options.include_historical_results).toBe(true);

  expect(await screen.findByText(/导入时间：2026-10-29 10:00/)).toBeVisible();
});
