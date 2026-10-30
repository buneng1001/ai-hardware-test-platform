import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  callsOf,
  completedAnalysis,
  factReport,
  openReportView,
  reportHistoryItem,
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

function baseState() {
  return {
    groups: [testGroupDetail({ id: 21, name: "EVT1 基础回归" })],
    executions: [],
    cases: [],
    batches: [],
    history: [],
    reports: {},
  };
}
test("AI 分析未启用时展示未启用状态且事实报告仍可查看", async () => {
  stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: { 5: factReport() },
  });
  await openReportView();
  fireEvent.click(
    await screen.findByRole("button", { name: "预览最新报告（HTML）" }),
  );

  const dialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  expect(within(dialog).getAllByText("AI 分析未启用").length).toBeGreaterThan(
    0,
  );
  expect(
    within(dialog).getByRole("heading", { name: "测试基本信息" }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("button", { name: "重试报告分析" }),
  ).toBeEnabled();
});

test("AI 分析失败时展示接口原因，并支持单独重试成功", async () => {
  const fetchMock = stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: {
      5: factReport({
        analysis: {
          status: "failed",
          message: "分析未完成：模型请求超时",
          output: null,
        },
      }),
    },
    analysisResult: completedAnalysis(),
  });
  await openReportView();
  fireEvent.click(
    await screen.findByRole("button", { name: "预览最新报告（HTML）" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  expect(within(dialog).getByText("分析未完成")).toBeVisible();
  expect(within(dialog).getByText("分析未完成：模型请求超时")).toBeVisible();

  fireEvent.click(within(dialog).getByRole("button", { name: "重试报告分析" }));

  expect(await within(dialog).findByText("分析已完成")).toBeVisible();
  expect(
    within(dialog).getByText(
      "请依据已保存事实报告补充验证后，再决定是否推进阶段。",
    ),
  ).toBeVisible();
  expect(
    within(dialog).getByText("优先人工复核失败与结果不一致项。"),
  ).toBeVisible();
  expect(within(dialog).getByText(/证据：stage_progress/)).toBeVisible();
  expect(
    callsOf(fetchMock).filter(
      ([input, init]) =>
        String(input) === "/api/fact-reports/5/analysis" &&
        init?.method === "POST",
    ),
  ).toHaveLength(1);
  expect(
    callsOf(fetchMock).filter(
      ([input, init]) =>
        String(input) === "/api/test-groups/21/fact-reports" &&
        init?.method === "POST",
    ),
  ).toHaveLength(0);
});

test("AI 分析完成后只展示建议区域且事实结论保持不变", async () => {
  stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: { 5: factReport({ analysis: completedAnalysis() }) },
  });
  await openReportView();
  fireEvent.click(
    await screen.findByRole("button", { name: "预览最新报告（HTML）" }),
  );

  const dialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  expect(within(dialog).getByText("分析已完成")).toBeVisible();
  expect(
    within(dialog).getAllByText(/不构成强制质量门禁/).length,
  ).toBeGreaterThan(0);
  expect(
    within(dialog).getByRole("heading", { name: "AI 风险提示" }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("heading", { name: "AI 补充验证建议" }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("heading", { name: "AI 回归建议" }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("heading", { name: "阶段推进事实依据" }),
  ).toBeVisible();
  expect(
    within(dialog).getAllByText("建议暂缓并补充验证").length,
  ).toBeGreaterThan(0);
});
