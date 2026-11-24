import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { V030RegressionResult } from "./V030RegressionResult";
import type { RegressionCandidate, RegressionResult } from "./factReportsApi";

const makeCandidate = (
  id: number,
  title: string,
  module: string,
  type: "manual" | "automation",
  sourceId: number,
): RegressionCandidate => ({
  id,
  title,
  module,
  case_type: type,
  priority: "high",
  test_item: title,
  reason: "复核报告中已发现的异常",
  preconditions: "设备已配对且电量充足",
  input: "测试数据 A",
  steps: "1. 开启采集\n2. 检查状态",
  expected_result: "采集状态正常，记录完整",
  sources: [{ report_id: sourceId, evidence_ref: "record:0:0" }],
  source_findings: [
    {
      report_id: sourceId,
      evidence_ref: "record:0:0",
      product_version: "EVT1",
      finding: "录像失败：文件缺失",
    },
  ],
});

const result = (invocationId = "run-1"): RegressionResult => ({
  project_id: 1,
  main_report_id: 20,
  main_product_version_id: 3,
  auxiliary_report_ids: [21],
  input_fingerprint: "input",
  ai_context_fingerprint: "context",
  report_fingerprints: {},
  invocation_id: invocationId,
  config_fingerprint: "config",
  is_mock: true,
  generated_at: "2026-11-24T13:00:00Z",
  prompt_version: "intelligent-regression-v1",
  invocation_status: "completed",
  overall_risk: { content: "风险", evidence_refs: [] },
  key_changes: { content: "变化", evidence_refs: [] },
  regression_focus: { content: "回归方向", evidence_refs: [] },
  summary: "共 3 条候选",
  modules: ["录像", "连接"],
  candidate_count: 3,
  candidates: [
    makeCandidate(1, "录像启动", "录像", "manual", 20),
    makeCandidate(2, "录像完整性", "录像", "automation", 21),
    makeCandidate(3, "蓝牙连接", "连接", "manual", 99),
  ],
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const checkbox = (title: string) =>
  screen.getByRole("checkbox", { name: `选择 ${title}` }) as HTMLInputElement;
const headerBox = () =>
  screen.getByRole("checkbox", {
    name: "全选当前筛选结果",
  }) as HTMLInputElement;
const moduleFilter = () =>
  screen.getByRole("combobox", { name: "回归用例模块筛选" });
const typeFilter = () =>
  screen.getByRole("combobox", { name: "回归用例执行方式筛选" });

test("T17 continuous table and intersection filters retain out-of-filter selection", () => {
  render(<V030RegressionResult result={result()} />);
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(screen.getAllByRole("columnheader")).toHaveLength(6);
  expect(screen.getByText("建议总数 3 · 当前命中 3 · 已选 0")).toBeTruthy();
  fireEvent.click(checkbox("蓝牙连接"));
  expect(headerBox().indeterminate).toBe(true);
  fireEvent.change(moduleFilter(), { target: { value: "录像" } });
  fireEvent.click(headerBox());
  expect(checkbox("录像启动").checked).toBe(true);
  expect(checkbox("录像完整性").checked).toBe(true);
  expect(screen.getByText("建议总数 3 · 当前命中 2 · 已选 3")).toBeTruthy();
  fireEvent.change(typeFilter(), { target: { value: "automation" } });
  fireEvent.click(screen.getByRole("button", { name: "反选当前筛选结果" }));
  expect(checkbox("录像完整性").checked).toBe(false);
  expect(screen.getByText("建议总数 3 · 当前命中 1 · 已选 2")).toBeTruthy();
  fireEvent.change(moduleFilter(), { target: { value: "连接" } });
  expect(screen.getByText("没有符合当前筛选条件的回归用例。")).toBeTruthy();
  expect(headerBox().disabled).toBe(true);
  fireEvent.change(typeFilter(), { target: { value: "" } });
  expect(checkbox("蓝牙连接").checked).toBe(true);
  fireEvent.change(moduleFilter(), { target: { value: "" } });
  expect(checkbox("录像启动").checked).toBe(true);
  expect(checkbox("录像完整性").checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
  expect(screen.getByText("建议总数 3 · 当前命中 3 · 已选 0")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "全选当前筛选结果" }));
  expect(headerBox().checked).toBe(true);
  fireEvent.click(headerBox());
  expect(screen.getByText("建议总数 3 · 当前命中 3 · 已选 0")).toBeTruthy();
});

test("T17 row details and real report ID preview with unavailable source feedback", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/21"))
        return Promise.resolve(
          new Response(JSON.stringify({ id: 21, snapshot: {} })),
        );
      return Promise.resolve(
        new Response(JSON.stringify({ detail: "not found" }), { status: 404 }),
      );
    }),
  );
  render(<V030RegressionResult result={result()} />);
  const title = screen.getByRole("button", { name: "录像完整性" });
  fireEvent.click(title);
  expect(title.getAttribute("aria-expanded")).toBe("true");
  const detail = screen.getByRole("region", { name: "录像完整性 详情" });
  for (const heading of [
    "前置条件",
    "测试输入",
    "测试步骤",
    "预期结果",
    "来源依据",
  ])
    expect(within(detail).getByText(heading)).toBeTruthy();
  expect(within(detail).getByText("采集状态正常，记录完整")).toBeTruthy();
  fireEvent.click(
    within(detail).getByRole("button", { name: "报告 #21 · EVT1" }),
  );
  const preview = await screen.findByRole("dialog", {
    name: "来源报告 #21 预览",
  });
  expect(calls).toEqual(["/api/fact-reports/21"]);
  expect(within(preview).getByTitle("报告 #21 HTML").getAttribute("src")).toBe(
    "/api/fact-reports/21.html",
  );
  fireEvent.click(
    within(preview).getByRole("button", { name: "关闭报告预览" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "蓝牙连接" }));
  fireEvent.click(screen.getByRole("button", { name: "报告 #99 · EVT1" }));
  await screen.findByText(/报告 #99 不存在、不可访问或加载失败/);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(calls).toEqual(["/api/fact-reports/21", "/api/fact-reports/99"]);
  expect(
    within(screen.getByRole("region", { name: "蓝牙连接 详情" })).getByText(
      "录像失败：文件缺失",
    ),
  ).toBeTruthy();
  fireEvent.click(title);
  expect(screen.queryByRole("region", { name: "录像完整性 详情" })).toBeNull();
});

test("T17 identical current invocation preserves selection, new invocation resets it", async () => {
  const view = render(<V030RegressionResult key="run-1" result={result()} />);
  fireEvent.click(checkbox("录像启动"));
  view.rerender(<V030RegressionResult key="run-1" result={result()} />);
  expect(checkbox("录像启动").checked).toBe(true);
  view.rerender(<V030RegressionResult key="run-2" result={result("run-2")} />);
  await waitFor(() => expect(checkbox("录像启动").checked).toBe(false));
  expect(screen.getByText("建议总数 3 · 当前命中 3 · 已选 0")).toBeTruthy();
});
