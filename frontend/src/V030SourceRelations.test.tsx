import {
  cleanup,
  fireEvent,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  automationCase,
  callsOf,
  openSourceView,
  sourceCase,
  stubApi,
  type StubState,
} from "./test/sourceCasesHarness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const automationCases = Array.from({ length: 23 }, (_, index) =>
  automationCase({
    id: index + 1,
    case_number: `A-${index + 1}`,
    title: `自动化检查 ${index + 1}`,
    source_test_case_id: [0, 21, 22].includes(index) ? 3 : index === 1 ? 2 : 4,
    source_case_number: [0, 21, 22].includes(index)
      ? "S-3"
      : index === 1
        ? "S-1"
        : "S-F",
    validation_status:
      index === 0 ? "passed" : index === 21 ? "failed" : "unvalidated",
  }),
);
const relations = automationCases
  .filter((item) => item.source_test_case_id === 3)
  .map(({ id, case_number, title, validation_status }) => ({
    id,
    case_number,
    title,
    validation_status,
  }));

test("T22: 全量关系、独立筛选、跨页定位，且所有操作只读", async () => {
  const fetch = stubApi({
    cases: [
      sourceCase({ id: 1, case_number: "S-0", test_type: "功能" }),
      sourceCase({
        id: 2,
        case_number: "S-1",
        test_type: "性能",
        case_type: "automation",
        automation_count: 1,
        automation_relations: [automationCases[1]],
      }),
      sourceCase({
        id: 3,
        case_number: "S-3",
        test_type: "功能",
        case_type: "automation",
        automation_count: 3,
        automation_relations: relations,
      }),
    ],
    automationCases,
    records: [],
  });
  await openSourceView();
  const row = (number: string) =>
    within(screen.getByText(number, { exact: true }).closest("tr")!);
  expect(row("S-0").queryByText(/自动化 ×/)).toBeNull();
  expect(row("S-1").getByText("自动化 ×1")).toBeVisible();
  expect(row("S-3").getByText("人工")).toBeVisible();
  expect(row("S-3").getByText("自动化 ×3")).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "类型筛选" }), {
    target: { value: "manual" },
  });
  expect(screen.getByText("S-0")).toBeVisible();
  expect(screen.queryByText("S-3")).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "类型筛选" }), {
    target: { value: "automation" },
  });
  expect(screen.queryByText("S-0")).toBeNull();
  expect(screen.getByText("S-1")).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "测试类型筛选" }), {
    target: { value: "功能" },
  });
  await waitFor(() => expect(screen.queryByText("S-1")).toBeNull());
  fireEvent.click(row("S-3").getByText("自动化 ×3"));
  const details = within(
    row("S-3").getByRole("list", { name: "S-3 关联自动化用例" }),
  );
  expect(details.getAllByRole("listitem")).toHaveLength(3);
  expect(details.getByText("已校验")).toBeVisible();
  expect(details.getByText("校验失败")).toBeVisible();
  expect(details.getByText("未校验")).toBeVisible();
  fireEvent.click(
    details.getByRole("button", { name: "A-23 · 自动化检查 23" }),
  );
  expect(await screen.findByText(/第 2 \/ 2 页/)).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: "选择自动化用例 A-23" }),
  ).toBeVisible();
  expect(document.getElementById("automation-test-case-23")).toHaveFocus();
  expect(
    callsOf(fetch).filter(([, init]) => init?.method && init.method !== "GET"),
  ).toHaveLength(0);
});

test("T22: 异常关系不显示假零，重试失败保留原表，重试成功恢复数量", async () => {
  const state: StubState = {
    cases: [
      sourceCase({
        id: 3,
        case_number: "S-3",
        automation_count: 3,
        automation_relations: [],
      }),
    ],
    records: [],
  };
  stubApi(state);
  await openSourceView();
  expect(screen.getByText("S-3")).toBeVisible();
  expect(screen.queryByText("自动化 ×0")).toBeNull();
  expect(screen.getByRole("button", { name: "重试关联" })).toBeVisible();
  state.failSourceTimes = 1;
  fireEvent.click(screen.getByRole("button", { name: "重试关联" }));
  await screen.findByText(/关联信息加载失败，请重试：数据库暂时不可用/);
  expect(screen.getByText("S-3")).toBeVisible();
  state.cases = [
    sourceCase({
      id: 3,
      case_number: "S-3",
      automation_count: 3,
      automation_relations: relations,
    }),
  ];
  fireEvent.click(screen.getByRole("button", { name: "重试关联" }));
  expect(await screen.findByText("自动化 ×3")).toBeVisible();
  expect(screen.queryByRole("button", { name: "重试关联" })).toBeNull();
});
