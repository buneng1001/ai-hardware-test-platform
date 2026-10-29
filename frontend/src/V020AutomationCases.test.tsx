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

test("自动化用例表展示真实候选、低可信度、来源链接和失败行原因", async () => {
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
  expect(screen.getByText(/低可信度/)).toBeVisible();
  expect(screen.getByText("缺少测试用例标题")).toBeVisible();
  expect(screen.getByText("缺少测试用例标题").closest("tr")).toHaveClass(
    "prototype-row-warning",
  );
});

test("生成自动化用例会展示规则候选和人工审核提示", async () => {
  const fetchMock = stubApi({
    cases: [],
    records: [],
    automationCases: [],
    automationConversion: {
      created_count: 1,
      items: [
        automationCase({
          id: 3,
          source_test_case_id: 4,
          source_case_number: "REC-001",
          case_number: "AUTO-000003",
        }),
      ],
    },
  });
  await openAutomationView();

  expect(screen.getByText("还没有自动化用例候选")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "生成自动化用例" }));

  expect(await screen.findByText("AUTO-000003")).toBeVisible();
  expect(screen.getByText("已生成 1 条规则候选，均需人工审核。")).toBeVisible();
  expect(
    callsOf(fetchMock).some(
      ([input, init]) =>
        String(input).endsWith("/automation-test-case-conversions/rules") &&
        init?.method === "POST",
    ),
  ).toBe(true);
  // 规则转换不依赖 AI 配置或模型服务。
  expect(
    callsOf(fetchMock).some(([input]) =>
      String(input).includes("/api/settings/ai"),
    ),
  ).toBe(false);
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

  fireEvent.click(screen.getByRole("button", { name: "生成自动化用例" }));
  expect(await screen.findByText("AUTO-000007")).toBeVisible();

  fireEvent.click(screen.getByRole("link", { name: "REC-001" }));
  expect(await screen.findByText("录制文件完整")).toBeVisible();
  const row = document.getElementById("source-test-case-4");
  expect(row).toHaveClass("prototype-row-highlight");
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

  fireEvent.click(screen.getByRole("button", { name: "生成自动化用例" }));
  expect(
    await screen.findByText("没有新的原始用例需要转换；已有候选不会被覆盖。"),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "导入用例表" })).toBeVisible();
});
