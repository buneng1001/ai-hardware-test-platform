import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  automationCase,
  callsOf,
  openAutomationTab,
  openAutomationView,
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

test("自动化用例表展示真实候选、来源链接和失败行原因", async () => {
  stubApi({
    cases: [
      sourceCase({ id: 4, case_number: "REC-001" }),
      sourceCase({ id: 5, case_number: "REC-002" }),
    ],
    records: [],
    automationCases: [
      automationCase({
        id: 1,
        source_test_case_id: 4,
        source_case_number: "REC-001",
      }),
      automationCase({
        id: 2,
        source_test_case_id: 5,
        source_case_number: "REC-002",
        case_number: "AUTO-000002",
        title: "",
        input: "",
        steps: "",
        expected_result: "",
        conversion_status: "failed",
        review_note: "缺少测试用例标题",
      }),
    ],
  });
  await openAutomationView();

  expect(screen.getByText("AUTO-000001")).toBeVisible();
  expect(screen.getByRole("link", { name: "REC-001" })).toHaveAttribute(
    "href",
    "#source-test-case-4",
  );
  // 规则候选不再展示“低可信度”这类内部说明。
  expect(screen.queryByText(/低可信度/)).toBeNull();
  expect(screen.getByText("缺少测试用例标题")).toBeVisible();
  expect(screen.getByText("缺少测试用例标题").closest("tr")).toHaveClass(
    "prototype-row-warning",
  );
});

test("自动化用例表不再重复提供生成入口", async () => {
  stubApi({
    cases: [],
    records: [],
    automationCases: [],
  });
  await openAutomationView();

  expect(screen.getByText("还没有自动化用例候选")).toBeVisible();
  expect(screen.getByText(/生成入口在“测试用例表”/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "生成自动化用例" })).toBeNull();
});

test("从测试用例表生成候选后可跳回来源原始用例", async () => {
  stubApi({
    cases: [
      sourceCase({ id: 4, case_number: "REC-001", title: "录制文件完整" }),
    ],
    records: [],
    automationConversion: {
      created_count: 1,
      items: [
        automationCase({
          id: 7,
          source_test_case_id: 4,
          source_case_number: "REC-001",
          case_number: "AUTO-000007",
        }),
      ],
    },
  });
  await openSourceView();

  fireEvent.click(screen.getByRole("button", { name: "全部转换（无AI）" }));
  expect(await screen.findByText("AUTO-000007")).toBeVisible();

  fireEvent.click(screen.getByRole("link", { name: "REC-001" }));
  await screen.findByRole("checkbox", { name: "选择用例 REC-001" });
  const row = document.getElementById("source-test-case-4");
  expect(row).toHaveClass("prototype-row-highlight");
});

test("来源跳转按 ID 定位第二页而非同标题记录", async () => {
  const cases = Array.from({ length: 25 }, (_, i) =>
    sourceCase({ id: i + 1, case_number: `SRC-${i + 1}`, title: "同标题" }),
  );
  const fetchMock = stubApi({
    cases,
    records: [],
    automationCases: [
      automationCase({
        id: 9,
        source_test_case_id: 25,
        source_case_number: "SRC-25",
      }),
    ],
  });
  await openAutomationView();
  fireEvent.click(screen.getByRole("link", { name: "SRC-25" }));
  expect(await screen.findByText(/第 2 \/ 2 页/)).toBeVisible();
  expect(document.getElementById("source-test-case-25")).toHaveClass(
    "prototype-row-highlight",
  );
  expect(document.getElementById("source-test-case-1")).toBeNull();
  expect(
    callsOf(fetchMock).filter(([url]) =>
      String(url).endsWith("/source-relation"),
    ),
  ).toHaveLength(1);
  expect(
    callsOf(fetchMock).filter(
      ([, init]) => init?.method && init.method !== "GET",
    ),
  ).toHaveLength(0);
});

test("自动化用例加载失败时展示原因并可以重试", async () => {
  stubApi({
    cases: [],
    records: [],
    automationCases: [automationCase({ id: 1 })],
    failAutomationTimes: 1,
  });
  await openAutomationTab();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "自动化用例加载失败：自动化用例服务暂时不可用",
  );

  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("AUTO-000001")).toBeVisible();
});

test("没有新的原始用例时提示不覆盖已有候选", async () => {
  stubApi({
    cases: [sourceCase({ id: 4, case_number: "REC-001" })],
    records: [],
    automationConversion: {
      created_count: 0,
      items: [automationCase({ id: 1 })],
    },
  });
  await openSourceView();

  fireEvent.click(screen.getByRole("button", { name: "全部转换（无AI）" }));
  expect(
    await screen.findByText("没有新的原始用例需要转换；已有候选不会被覆盖。"),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "导入用例表" })).toBeVisible();
});
