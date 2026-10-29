import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  callsOf,
  importRecord,
  openCasesTab,
  openSourceView,
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

test("没有原始用例时展示空状态", async () => {
  stubApi({ cases: [], records: [] });
  await openSourceView();

  expect(await screen.findByText("还没有原始测试用例")).toBeVisible();
});

test("加载失败时展示错误原因并可以重试", async () => {
  stubApi({
    cases: [sourceCase({ id: 1, case_number: "REC-001" })],
    records: [],
    failSourceTimes: 1,
  });
  await openCasesTab();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("原始测试用例加载失败：数据库暂时不可用");

  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(
    await screen.findByRole("checkbox", { name: "选择用例 REC-001" }),
  ).toBeVisible();
});

test("删除导入记录前展示影响并保留原始用例的来源状态", async () => {
  const fetchMock = stubApi({
    cases: [sourceCase({ id: 1 })],
    records: [importRecord()],
    impact: {
      import_record_id: 7,
      source_test_cases: 1,
      automation_test_cases: 2,
      message:
        "删除后原始用例保留，但其来源会标记为“导入记录已删除”；已有自动化用例不会被删除。",
    },
  });
  await openSourceView();

  fireEvent.click(screen.getByRole("button", { name: "删除导入记录" }));
  const dialog = await screen.findByRole("dialog", {
    name: "删除导入记录影响",
  });
  expect(dialog).toHaveTextContent("删除后原始用例保留");
  expect(dialog).toHaveTextContent("原始用例：1 条");
  expect(dialog).toHaveTextContent("2 条");

  fireEvent.click(screen.getByRole("button", { name: "确认删除导入记录" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "删除导入记录影响" }),
    ).toBeNull(),
  );
  expect(
    callsOf(fetchMock).some(
      ([input, init]) =>
        String(input) === "/api/source-test-case-imports/7?confirm=true" &&
        init?.method === "DELETE",
    ),
  ).toBe(true);
  expect(await screen.findByText("导入记录已删除")).toBeVisible();
});

test("测试需求页明确显示需求点拆解与用例生成未启用", async () => {
  stubApi({ cases: [], records: [] });
  await openCasesTab();

  fireEvent.click(screen.getByRole("button", { name: "测试需求" }));
  expect(screen.getByText("未启用")).toBeVisible();
  expect(screen.getByText(/平台不会伪造需求点或测试用例/)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "前往导入测试用例资料" }));
  expect(
    await screen.findByRole("button", { name: "导入用例表" }),
  ).toBeVisible();
});
