import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ReportHistoryItem } from "./factReportsApi";
import {
  callsOf,
  factReport,
  openReportView,
  reportAttachmentSummary,
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

test("过期在线报告仍可查看和下载，并明确提示不会自动改写", async () => {
  stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5, "stale")],
    reports: { 5: factReport({ lifecycle_status: "stale" }) },
  });
  await openReportView();
  expect(await screen.findByText("在线报告已过期")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "预览最新报告（HTML）" }));
  const dialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  expect(
    within(dialog).getByText(/该在线报告已过期，仍可查看和下载/),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("link", { name: "下载 HTML 报告" }),
  ).toHaveAttribute("href", "/api/fact-reports/5.html");
  expect(
    within(dialog).getByRole("link", { name: "下载纯文字报告" }),
  ).toHaveAttribute("href", "/api/fact-reports/5.txt");
});

test("报告展示已使用附件并可确认后清理，保留名称和已清理状态", async () => {
  const fetchMock = stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: {
      5: factReport({ attachment_summary: reportAttachmentSummary() }),
    },
  });
  await openReportView();
  fireEvent.click(
    await screen.findByRole("button", { name: "预览最新报告（HTML）" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  expect(within(dialog).getByText("共 2 个，合计 3072 字节。")).toBeVisible();
  expect(
    within(dialog).getByText(/shot.png：已使用，原始文件已保留/),
  ).toBeVisible();

  fireEvent.click(
    within(dialog).getByRole("button", { name: "清理已使用附件" }),
  );
  const impact = await within(dialog).findByRole("dialog", {
    name: "附件清理影响确认",
  });
  expect(impact).toHaveTextContent("清理当前报告已使用附件的原始文件");
  expect(impact).toHaveTextContent("将清理 2 个附件，共 3072 字节");
  fireEvent.click(
    within(impact).getByRole("button", { name: "确认清理已使用附件" }),
  );

  await waitFor(() =>
    expect(within(dialog).getAllByText(/原始文件已清理/).length).toBe(2),
  );
  expect(
    callsOf(fetchMock).some(
      ([input, init]) =>
        String(input) === "/api/fact-reports/5/used-attachments?confirm=true" &&
        init?.method === "DELETE",
    ),
  ).toBe(true);
  expect(
    within(dialog).getByRole("link", { name: "下载 HTML 报告" }),
  ).toBeVisible();
});

test("删除在线报告前展示影响，且不删除执行、人工记录或数据包", async () => {
  const fetchMock = stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: { 5: factReport() },
  });
  await openReportView();
  await screen.findByText(/报告 #5/);

  fireEvent.click(screen.getByRole("button", { name: "删除在线报告" }));
  const dialog = await screen.findByRole("dialog", {
    name: "删除在线报告影响",
  });
  expect(dialog).toHaveTextContent("不删除自动化执行记录、人工记录、数据包");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "确认删除在线报告" }),
  );

  expect(
    await screen.findByText(
      "在线报告已删除；自动化执行、人工记录和数据包不受影响。",
    ),
  ).toBeVisible();
  expect(await screen.findByText("尚无在线报告")).toBeVisible();
  expect(
    callsOf(fetchMock).some(
      ([input, init]) =>
        String(input) === "/api/fact-reports/5" && init?.method === "DELETE",
    ),
  ).toBe(true);
});

test("报告与历史记录可查找自动化执行、人工记录和最终报告", async () => {
  const historyItems: ReportHistoryItem[] = [
    reportHistoryItem(5),
    {
      record_type: "automation_execution",
      id: 3,
      label: "自动化执行 #3",
      status: "completed",
      occurred_at: "2026-10-30T09:00:00+00:00",
    },
    {
      record_type: "manual_result",
      id: 1,
      label: "人工记录批次 #1",
      status: "recorded",
      occurred_at: "2026-10-30T08:00:00+00:00",
    },
  ];
  const fetchMock = stubReportApi({
    ...baseState(),
    history: historyItems,
    reports: { 5: factReport() },
  });
  await openReportView();
  await screen.findByText(/报告 #5/);

  fireEvent.click(screen.getByRole("button", { name: "查看报告列表" }));
  const dialog = await screen.findByRole("dialog", {
    name: "历史报告列表",
  });
  expect(within(dialog).getByText("自动化执行 #3")).toBeVisible();
  expect(within(dialog).getByText("人工记录批次 #1")).toBeVisible();
  expect(within(dialog).getByText("最终报告 #5")).toBeVisible();

  fireEvent.change(within(dialog).getByLabelText("查找报告与历史记录"), {
    target: { value: "人工" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "查找" }));

  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(([input]) => {
        const url = new URL(String(input), "http://local");
        return (
          url.pathname.endsWith("/report-history") &&
          url.searchParams.get("query") === "人工"
        );
      }),
    ).toBe(true),
  );
  expect(await within(dialog).findByText("人工记录批次 #1")).toBeVisible();
  expect(within(dialog).queryByText("自动化执行 #3")).toBeNull();
});
