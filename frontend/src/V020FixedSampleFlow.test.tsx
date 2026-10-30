import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FrontendRoot } from "./FrontendRoot";
import type { ProjectTrend } from "./projectsApi";
import { installFixedSampleApi } from "./test/fixedSampleApi";

const counts = {
  automation: { passed: 8, failed: 2, blocked: 1, not_executed: 1 },
  manual: { passed: 0, failed: 0, blocked: 0, not_executed: 1 },
};

const fixedTrend: ProjectTrend = {
  project_id: 1,
  status: "ready",
  message: "共 1 份最终报告",
  points: [
    {
      report_id: 5,
      product_version_id: 11,
      product_version: "EVT1",
      test_group_id: 21,
      test_group: "EVT1 基础录制回归",
      created_at: "2026-10-30T10:00:00+00:00",
      lifecycle_status: "current",
      counts,
      modules: [
        {
          name: "录制功能",
          conclusion: "建议暂缓并补充验证",
          counts,
        },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function openFixedSampleWorkspace() {
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));
  await screen.findByRole("heading", { name: "EVT1 测试工作区" });
}

test("冻结版固定样例贯通用例、数据、测试组、执行、人工结果、报告与趋势", async () => {
  installFixedSampleApi({ trend: fixedTrend });
  render(<FrontendRoot />);
  await openFixedSampleWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "需求 / 测试用例" }));
  fireEvent.click(screen.getByRole("button", { name: "测试用例表" }));
  expect(await screen.findByText("TC-REC-001")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "自动化用例表" }));
  expect(await screen.findByText("AUTO-000001")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "测试数据" }));
  expect(await screen.findByText("DP-000007")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "测试组设置" }));
  expect(await screen.findByText("EVT1 基础录制回归")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "编辑设置" }));
  expect(
    await screen.findByRole("region", {
      name: "EVT1 基础录制回归 测试组详情",
    }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "执行与结果" }));
  expect(await screen.findByText("自动化执行 #3")).toBeVisible();
  expect(screen.getByText("通过 8 · 失败 2 · 阻塞 1 · 未执行 1")).toBeVisible();

  fireEvent.click(
    await screen.findByRole("button", { name: "进入人工结果录入" }),
  );
  expect(
    await screen.findByRole("heading", { name: "逐条录入人工测试" }),
  ).toBeVisible();
  expect(screen.getByText("SRC-001")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "返回执行与结果" }));

  expect(await screen.findByText(/报告 #5/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "预览最新报告（HTML）" }));
  const reportDialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  const headings = within(reportDialog)
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
  expect(
    within(reportDialog).getByRole("link", { name: "下载 HTML 报告" }),
  ).toBeVisible();
  expect(
    within(reportDialog).getByRole("link", { name: "下载纯文字报告" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭报告预览" }));

  fireEvent.click(screen.getByRole("button", { name: "版本与趋势" }));
  expect(
    await screen.findByText("报告 #5 · EVT1 · EVT1 基础录制回归"),
  ).toBeVisible();
  expect(screen.getByText("当前报告")).toBeVisible();
  expect(screen.getByLabelText("左侧比较对象")).toHaveValue("");
  expect(screen.getByLabelText("右侧比较对象")).toHaveValue("");
}, 15000);
