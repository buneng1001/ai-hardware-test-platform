import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { V020ReportAnalysisSection } from "./V020ReportAnalysisSection";
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

test("输出截断时明确提示截断而不是格式不兼容", async () => {
  stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: {
      5: factReport({
        analysis: {
          status: "failed",
          message: "分析未完成：模型输出被截断（finish_reason=length）",
          output: null,
          error: {
            stage: "report_analysis",
            kind: "output_truncated",
            action: "缩小单批范围或提高输出上限后重试",
          },
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
  expect(
    within(dialog).getByText(/模型输出被截断（finish_reason=length）/),
  ).toBeVisible();
  expect(
    within(dialog).getByText("下一步：缩小单批范围或提高输出上限后重试"),
  ).toBeVisible();
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
          error: {
            stage: "report_analysis",
            kind: "timeout",
            action: "检查网络或缩小请求范围后重试",
          },
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
  expect(
    within(dialog).getByText("下一步：检查网络或缩小请求范围后重试"),
  ).toBeVisible();

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
  expect(
    within(dialog).getByRole("link", { name: "stage_progress" }),
  ).toHaveAttribute("href", "#rpt-overview");
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

test("报告 AI 正在执行时允许就地取消，并显示正在停止状态", async () => {
  const fetchMock = stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: {
      5: factReport({
        analysis: {
          status: "pending",
          message: "AI 分析正在运行",
          output: null,
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
  const cancelButton = within(dialog).getByRole("button", {
    name: "取消本次 AI 分析",
  });
  expect(cancelButton).toBeEnabled();
  fireEvent.click(cancelButton);
  expect(
    await within(dialog).findByRole("button", { name: "正在停止" }),
  ).toBeDisabled();
  expect(
    callsOf(fetchMock).filter(
      ([input, init]) =>
        String(input) === "/api/fact-reports/5/analysis/cancel" &&
        init?.method === "POST",
    ),
  ).toHaveLength(1);
  expect(
    within(dialog).getByRole("heading", { name: "总体结论与通过率" }),
  ).toBeVisible();
});

test("关闭报告预览后工作区持续刷新，重新查看不会停留在旧状态", async () => {
  const state = {
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: {
      5: factReport({
        analysis: {
          status: "pending",
          message: "AI 分析正在运行",
          output: null,
        },
      }),
    },
  };
  const fetchMock = stubReportApi(state);
  await openReportView();
  fireEvent.click(await screen.findByRole("button", { name: "查看主报告 #5" }));
  const dialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭报告预览" }));
  expect(
    screen.queryByRole("dialog", { name: "报告 #5 HTML 预览" }),
  ).toBeNull();
  state.reports[5] = { ...state.reports[5], analysis: completedAnalysis() };
  await waitFor(
    () =>
      expect(screen.getByText("AI 分析已完成，可生成回归建议")).toBeVisible(),
    { timeout: 3500 },
  );
  fireEvent.click(screen.getByRole("button", { name: "查看主报告 #5" }));
  const reopened = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  expect(within(reopened).getByText("分析已完成")).toBeVisible();
  expect(
    callsOf(fetchMock).filter(
      ([url, init]) =>
        String(url).endsWith("/analysis/cancel") && init?.method === "POST",
    ),
  ).toHaveLength(0);
});

test("超过五分钟仍查询后端，收到终态立即停止查询", async () => {
  vi.useFakeTimers();
  try {
    const report = factReport({
      analysis: { status: "pending", message: "AI 分析正在运行", output: null },
    });
    const onRefresh = vi.fn(async () => {});
    const props = {
      busy: false,
      onRetry: vi.fn(),
      onRerun: vi.fn(),
      onCheckRepeat: async () => ({
        same_input: false,
        has_previous: false,
        running_same_operation: false,
        occupied_other: false,
      }),
      onRefresh,
      onCancel: async () => "",
    };
    const view = render(
      <V020ReportAnalysisSection {...props} report={report} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(543000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(181);
    expect(screen.getByText(/已等待 543 秒/)).toBeVisible();
    view.rerender(
      <V020ReportAnalysisSection
        {...props}
        report={{
          ...report,
          analysis: {
            status: "failed",
            message: "模型分析结构无效",
            output: null,
          },
        }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(181);
    expect(screen.queryByText(/已等待/)).toBeNull();
    expect(screen.getByText("模型分析结构无效")).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

test("点击取消时后台已失败，弹窗直接刷新终态而非停留运行中", async () => {
  const state = {
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: {
      5: factReport({
        analysis: {
          status: "pending",
          message: "AI 分析正在运行",
          output: null,
        },
      }),
    },
  };
  const fetchMock = stubReportApi(state);
  await openReportView();
  fireEvent.click(
    await screen.findByRole("button", { name: "预览最新报告（HTML）" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  state.reports[5] = {
    ...state.reports[5],
    analysis: {
      status: "failed",
      message: "分析未完成：模型分析结构无效",
      output: null,
    },
  };
  fireEvent.click(
    within(dialog).getByRole("button", { name: "取消本次 AI 分析" }),
  );
  expect(
    await within(dialog).findByText("本次分析已结束，已刷新实际结果。"),
  ).toBeVisible();
  expect(
    within(dialog).getByText("分析未完成：模型分析结构无效"),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole("button", { name: "取消本次 AI 分析" }),
  ).toBeNull();
  expect(
    within(dialog).getByRole("button", { name: "重试报告分析" }),
  ).toBeEnabled();
  expect(
    callsOf(fetchMock).filter(
      ([url, init]) =>
        String(url).endsWith("/analysis/cancel") && init?.method === "POST",
    ),
  ).toHaveLength(1);
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
    within(dialog).getByRole("heading", { name: "总体结论与通过率" }),
  ).toBeVisible();
  expect(
    within(dialog).getAllByText("建议暂缓并补充验证").length,
  ).toBeGreaterThan(0);
});

test("专业测试分析按优先级合并缺口风险和测试方向，历史格式保持兼容", async () => {
  const legacy = completedAnalysis();
  const analysis = {
    ...legacy,
    output: {
      ...legacy.output!,
      test_directions: [
        {
          dimension: "performance",
          priority: "medium" as const,
          title: "录像性能",
          coverage_gap: "缺少性能证据",
          risk: "可能存在资源瓶颈",
          direction: "关注吞吐与延迟",
          evidence_refs: ["product_profile"],
        },
        {
          dimension: "functional",
          priority: "high" as const,
          title: "实机功能覆盖",
          coverage_gap: "仅有模拟证据",
          risk: "实机可靠性未证实",
          direction: "补齐实机功能验证",
          evidence_refs: ["execution_context"],
        },
      ],
    },
  };
  stubReportApi({
    ...baseState(),
    history: [reportHistoryItem(5)],
    reports: { 5: factReport({ analysis }) },
  });
  await openReportView();
  fireEvent.click(
    await screen.findByRole("button", { name: "预览最新报告（HTML）" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  expect(
    within(dialog).getByRole("heading", { name: "01 综合评价" }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("heading", { name: "03 下一阶段测试重点" }),
  ).toBeVisible();
  const high = within(dialog).getByText("实机功能覆盖").closest("details")!;
  const medium = within(dialog).getByText("录像性能").closest("details")!;
  expect(high.open).toBe(true);
  expect(medium.open).toBe(false);
  expect(
    high.compareDocumentPosition(medium) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(within(high).getByText("补齐实机功能验证")).toBeVisible();
  expect(
    within(dialog).queryByRole("heading", { name: "AI 风险提示" }),
  ).toBeNull();
  expect(
    within(dialog).getByRole("heading", { name: "总体结论与通过率" }),
  ).toBeVisible();
});

test("T07 同输入报告再运行先确认，默认保留旧结果", async () => {
  const onRerun = vi.fn();
  render(
    <V020ReportAnalysisSection
      report={factReport({ analysis: completedAnalysis() })}
      busy={false}
      onRetry={() => {}}
      onRerun={onRerun}
      onCheckRepeat={async () => ({
        same_input: true,
        has_previous: true,
        running_same_operation: false,
        occupied_other: false,
      })}
      onRefresh={async () => {}}
      onCancel={async () => ""}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "重新运行分析" }));
  const confirm = await screen.findByRole("dialog", {
    name: "确认重复报告分析",
  });
  expect(
    within(confirm).getByRole("checkbox", { name: "覆盖上一次结果" }),
  ).not.toBeChecked();
  expect(onRerun).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole("button", { name: "重新执行" }));
  await waitFor(() => expect(onRerun).toHaveBeenCalledWith(false));
});
