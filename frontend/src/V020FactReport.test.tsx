import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { executionRecord } from "./test/automationExecutionHarness";
import { manualBatch } from "./test/manualResultsHarness";
import {
  callsOf,
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

test("执行与结果页展示真实在线报告摘要、状态和下载入口", async () => {
  const report = factReport();
  stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: { 5: report },
  });
  await openReportView();

  expect(await screen.findByText(/报告 #5/)).toBeVisible();
  expect(screen.getByText("当前在线报告")).toBeVisible();
  expect(screen.getByText(/建议暂缓并补充验证/)).toBeVisible();
  expect(screen.getByText(/AI 区域状态：not_configured/)).toBeVisible();
  expect(screen.getByRole("link", { name: "下载纯文字" })).toHaveAttribute(
    "href",
    "/api/fact-reports/5.txt",
  );
  expect(screen.queryByText(/AI 回测建议：/)).toBeNull();
});

test("生成最终报告后按固定顺序预览并下载 HTML 与纯文字", async () => {
  const fetchMock = stubReportApi({
    ...baseState(),
    executions: [executionRecord({ id: 3, execution_number: 3 })],
    batches: [manualBatch(1, 1, [])],
    createdReport: factReport({
      id: 9,
      automation_execution_id: 3,
      manual_batch_ids: [1],
    }),
  });
  await openReportView();

  fireEvent.click(await screen.findByRole("button", { name: "生成最终报告" }));
  fireEvent.change(screen.getByLabelText("自动化执行记录"), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByLabelText("选择人工批次 #1"));
  fireEvent.click(screen.getByRole("button", { name: "生成事实报告" }));

  expect(
    await screen.findByRole("heading", { name: "测试基本信息" }),
  ).toBeVisible();
  const dialog = screen.getByRole("dialog", { name: "报告 #9 HTML 预览" });
  expect(
    within(dialog).getByRole("heading", { name: "阶段推进事实依据" }),
  ).toBeVisible();
  const headings = within(dialog)
    .getAllByRole("heading", { level: 2 })
    .map((item) => item.textContent);
  expect(headings.slice(0, 6)).toEqual([
    "测试基本信息",
    "阶段推进事实依据",
    "AI 区域状态",
    "范围总览",
    "模块详情",
    "跨模块问题",
  ]);
  expect(headings).toContain("已使用附件");
  expect(screen.getByTitle("事实报告 HTML 预览")).toHaveAttribute(
    "src",
    "/api/fact-reports/9.html",
  );
  expect(screen.getByRole("link", { name: "下载 HTML 报告" })).toHaveAttribute(
    "href",
    "/api/fact-reports/9.html",
  );
  expect(screen.getByRole("link", { name: "下载纯文字报告" })).toHaveAttribute(
    "href",
    "/api/fact-reports/9.txt",
  );
  const posted = callsOf(fetchMock).find(
    ([input, init]) =>
      String(input) === "/api/test-groups/21/fact-reports" &&
      init?.method === "POST",
  );
  const body = JSON.parse(String(posted?.[1]?.body)) as {
    automation_execution_id: number | null;
    manual_batch_ids: number[];
  };
  expect(body).toEqual({
    automation_execution_id: 3,
    manual_batch_ids: [1],
  });
});

test("只有人工记录时也允许生成报告", async () => {
  const fetchMock = stubReportApi({
    ...baseState(),
    batches: [manualBatch(1, 1, [])],
    createdReport: factReport({
      id: 10,
      automation_execution_id: null,
      manual_batch_ids: [1],
      snapshot: {
        ...factReport().snapshot,
        basic_information: {
          ...factReport().snapshot.basic_information,
          contains: "人工结果",
          automation_execution: null,
        },
      },
    }),
  });
  await openReportView();

  fireEvent.click(await screen.findByRole("button", { name: "生成最终报告" }));
  fireEvent.click(screen.getByLabelText("选择人工批次 #1"));
  fireEvent.click(screen.getByRole("button", { name: "生成事实报告" }));

  expect(
    await screen.findByRole("dialog", { name: "报告 #10 HTML 预览" }),
  ).toBeVisible();
  const posted = callsOf(fetchMock).find(
    ([input, init]) =>
      String(input) === "/api/test-groups/21/fact-reports" &&
      init?.method === "POST",
  );
  const body = JSON.parse(String(posted?.[1]?.body)) as {
    automation_execution_id: number | null;
  };
  expect(body.automation_execution_id).toBeNull();
});

test("报告列表展示真实生命周期并可预览历史报告", async () => {
  stubReportApi({
    ...baseState(),
    history: [
      reportHistoryItem(5),
      reportHistoryItem(4, "stale", "2026-10-29T10:00:00+00:00"),
      reportHistoryItem(3, "superseded", "2026-10-28T10:00:00+00:00"),
    ],
    reports: {
      5: factReport(),
      4: factReport({ id: 4, lifecycle_status: "stale" }),
    },
  });
  await openReportView();
  await screen.findByText(/报告 #5/);

  fireEvent.click(screen.getByRole("button", { name: "查看报告列表" }));
  const historyDialog = await screen.findByRole("dialog", {
    name: "历史报告列表",
  });
  expect(within(historyDialog).getByText("当前在线")).toBeVisible();
  expect(within(historyDialog).getByText("已过期")).toBeVisible();
  expect(within(historyDialog).getByText("已覆盖")).toBeVisible();

  fireEvent.click(
    within(historyDialog).getByRole("button", { name: "预览报告 #4" }),
  );
  const stalePreview = await screen.findByRole("dialog", {
    name: "报告 #4 HTML 预览",
  });
  expect(within(stalePreview).getAllByText(/已过期/).length).toBeGreaterThan(0);
});

test("历史快照警告和 AI 未配置不会阻止报告交付", async () => {
  stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: {
      5: factReport({
        snapshot: {
          ...factReport().snapshot,
          warnings: ["当前记录来自历史配置，报告将使用历史快照。"],
        },
      }),
    },
  });
  await openReportView();

  expect(
    await screen.findByText("当前记录来自历史配置，报告将使用历史快照。"),
  ).toBeVisible();
  expect(screen.getByText(/AI 区域状态：not_configured/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "预览最新报告（HTML）" }),
  ).toBeEnabled();
});

test("自动化和人工结果冲突时保留双方记录并标记结果不一致", async () => {
  const base = factReport();
  stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: {
      5: factReport({
        snapshot: {
          ...base.snapshot,
          modules: [
            {
              name: "采集",
              conclusion: "存在结果不一致",
              counts: { passed: 1, failed: 1, blocked: 0, not_executed: 0 },
              records: [
                {
                  case_number: "SRC-001",
                  title: "录制",
                  module: "采集",
                  test_item: "录制",
                  source: "自动化",
                  status: "passed",
                  message: "确定性数据检查结果符合用例预期。",
                  executed_at: null,
                  result_consistency: "结果不一致",
                },
                {
                  case_number: "SRC-001",
                  title: "录制",
                  module: "采集",
                  test_item: "录制",
                  source: "人工",
                  status: "failed",
                  message: "实际无法开始录制",
                  executed_at: null,
                  result_consistency: "结果不一致",
                },
              ],
            },
          ],
          cross_module_issues: [
            {
              case_number: "SRC-001",
              message: "自动化和人工记录结果不一致，已保留双方事实记录。",
            },
          ],
        },
      }),
    },
  });
  await openReportView();
  fireEvent.click(
    await screen.findByRole("button", { name: "预览最新报告（HTML）" }),
  );

  const dialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  expect(within(dialog).getByText("存在结果不一致")).toBeVisible();
  expect(within(dialog).getAllByText(/结果不一致/).length).toBeGreaterThan(1);
  expect(within(dialog).getByText(/已保留双方事实记录/)).toBeVisible();
});

test("没有在线报告时禁用预览，加载失败可重试", async () => {
  stubReportApi({ ...baseState(), failHistoryTimes: 1 });
  await openReportView();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("最终报告加载失败：报告服务暂时不可用");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));

  expect(await screen.findByText("尚无在线报告")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "预览最新报告（HTML）" }),
  ).toBeDisabled();
});
