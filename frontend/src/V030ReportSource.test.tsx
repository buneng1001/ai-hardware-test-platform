import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { executionRecord } from "./test/automationExecutionHarness";
import { manualBatch } from "./test/manualResultsHarness";
import {
  callsOf,
  factReport,
  openReportView,
  stubReportApi,
} from "./test/reportHarness";
import { testGroupDetail } from "./test/testGroupFixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function state() {
  const base = factReport();
  return {
    groups: [testGroupDetail({ id: 21, name: "EVT1 基础回归" })],
    executions: [executionRecord({ id: 3, execution_number: 3 })],
    cases: [],
    batches: [manualBatch(2, 2, []), manualBatch(1, 1, [])],
    history: [],
    reports: {},
    historicalOptions: [
      {
        id: 7,
        product_version: "EVT0",
        test_group: "历史组",
        created_at: "2026-10-20T10:00:00+00:00",
        overall: { ...base.snapshot.pass_rate.overall, rate: 15 },
      },
    ],
    createdReport: factReport({
      id: 9,
      automation_execution_id: null,
      manual_batch_ids: [1, 2],
      historical_report_ids: [7],
      snapshot: {
        ...base.snapshot,
        historical_reports: [
          {
            report_id: 7,
            product_version: "EVT0",
            test_group: "历史组",
            generated_at: "2026-10-20T10:00:00+00:00",
            statistics_snapshot: {
              scope_overview: base.snapshot.scope_overview,
              pass_rate: {
                ...base.snapshot.pass_rate,
                overall: { ...base.snapshot.pass_rate.overall, rate: 15 },
              },
              stage_progress: base.snapshot.stage_progress,
            },
          },
        ],
      },
    }),
  };
}

test("T13 报告来源明确无、人工多批次、历史跨版本独立对照", async () => {
  const fetchMock = stubReportApi(state());
  await openReportView();
  const automatic = await screen.findByLabelText("最终报告自动化来源");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "生成最终报告" })).toBeEnabled(),
  );

  fireEvent.change(automatic, { target: { value: "none" } });
  const manualDetails = screen
    .getByText(/^人工测试结果（多选）/)
    .closest("details");
  expect(manualDetails).not.toBeNull();
  fireEvent.click(within(manualDetails!).getByText(/^人工测试结果（多选）/));
  fireEvent.click(
    within(manualDetails!).getByRole("button", {
      name: "无（不参与本次报告）",
    }),
  );
  expect(screen.getByRole("button", { name: "生成最终报告" })).toBeDisabled();

  fireEvent.click(within(manualDetails!).getByLabelText("选择人工批次 #1"));
  fireEvent.click(within(manualDetails!).getByLabelText("选择人工批次 #2"));
  const historyDetails = screen
    .getByText(/^历史最终报告（多选）/)
    .closest("details");
  expect(historyDetails).not.toBeNull();
  fireEvent.click(within(historyDetails!).getByText(/^历史最终报告（多选）/));
  fireEvent.click(within(historyDetails!).getByLabelText("选择历史报告 #7"));

  fireEvent.click(screen.getByRole("button", { name: "生成最终报告" }));
  const confirm = await screen.findByRole("dialog", {
    name: "确认生成最终报告",
  });
  expect(within(confirm).getByText(/#2、#1/)).toBeVisible();
  expect(within(confirm).getByText(/#7（EVT0）/)).toBeVisible();
  fireEvent.click(within(confirm).getByRole("button", { name: "确认生成" }));

  const preview = await screen.findByRole("dialog", {
    name: "报告 #9 HTML 预览",
  });
  expect(
    within(preview).getByRole("heading", {
      name: "历史最终报告对照（不计入当前版本统计）",
    }),
  ).toBeVisible();
  expect(within(preview).getByText("EVT0")).toBeVisible();
  expect(within(preview).getByText("15%")).toBeVisible();

  const created = callsOf(fetchMock).find(
    ([input, init]) =>
      String(input) === "/api/test-groups/21/fact-reports" &&
      init?.method === "POST",
  );
  expect(JSON.parse(String(created?.[1]?.body))).toEqual({
    automation_execution_id: null,
    manual_batch_ids: [1, 2],
    historical_report_ids: [7],
  });
});

test("T13 显式无跨页面重新加载保持，不回退最新记录", async () => {
  stubReportApi(state());
  await openReportView();
  const automatic = await screen.findByLabelText("最终报告自动化来源");
  await waitFor(() => expect(automatic).toHaveValue("3"));
  fireEvent.change(automatic, { target: { value: "none" } });
  const manualDetails = screen
    .getByText(/^人工测试结果（多选）/)
    .closest("details")!;
  fireEvent.click(within(manualDetails).getByText(/^人工测试结果（多选）/));
  fireEvent.click(
    within(manualDetails).getByRole("button", { name: "无（不参与本次报告）" }),
  );
  expect(screen.getByRole("button", { name: "生成最终报告" })).toBeDisabled();

  const explicitChoice = window.localStorage.getItem("v030-report-source-21");
  cleanup();
  // 重开工作区时保留报告来源选择；测试框架自己的导航状态重新初始化。
  window.localStorage.clear();
  window.sessionStorage.clear();
  if (explicitChoice)
    window.localStorage.setItem("v030-report-source-21", explicitChoice);
  await openReportView();
  expect(await screen.findByLabelText("最终报告自动化来源")).toHaveValue(
    "none",
  );
  expect(
    screen.getByText(/^人工测试结果（多选）：无（不参与本次报告）/),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "生成最终报告" })).toBeDisabled();
  expect(screen.getByText(/至少需要一项有效事实来源/)).toBeVisible();
});
