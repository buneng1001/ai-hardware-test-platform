import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { FrontendRoot } from "./FrontendRoot";
import { installFixedSampleApi } from "./test/fixedSampleApi";

beforeEach(() => {
  installFixedSampleApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function renderWorkspace() {
  render(<FrontendRoot />);
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));
  await screen.findByTestId("prototype-workspace-shell");
}

test("工作区侧边栏可以折叠并在前端保存状态", async () => {
  await renderWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
  expect(screen.getByTestId("prototype-workspace-shell")).toHaveClass(
    "prototype-shell--collapsed",
  );
  expect(window.localStorage.getItem("iris-test-sidebar-collapsed")).toBe(
    "true",
  );
  expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
});

test("浏览器存储不可用时侧边栏仍可进入和折叠", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("storage blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("storage blocked", "SecurityError");
  });

  await renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));

  expect(screen.getByTestId("prototype-workspace-shell")).toHaveClass(
    "prototype-shell--collapsed",
  );
});
test("测试用例表读取真实原始用例并支持模块筛选与加入测试组", async () => {
  await renderWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "需求 / 测试用例" }));
  fireEvent.click(screen.getByRole("button", { name: "测试用例表" }));

  expect(
    await screen.findByRole("columnheader", { name: "测试步骤" }),
  ).toBeVisible();
  expect(screen.getByText("确认设备处于待机状态")).toBeVisible();
  expect(screen.getByText("短按录制键，确认开始录制")).toBeVisible();
  expect(screen.getByRole("button", { name: "加入测试组" })).toBeVisible();
  expect(screen.getByRole("button", { name: "导入用例表" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Beta/i })).toBeNull();

  const moduleFilter = screen.getByRole("combobox", { name: "模块筛选" });
  fireEvent.change(moduleFilter, { target: { value: "电源管理" } });
  expect(await screen.findByText("设备断电后数据保存状态")).toBeVisible();
  expect(screen.queryByText("短按录制键，确认开始录制")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "加入测试组" }));
  expect(screen.getByRole("heading", { name: "测试组设置" })).toBeVisible();
  expect(screen.getByRole("button", { name: "＋ 新建测试组" })).toBeVisible();
});

test("测试数据支持复制编号且测试组数据包可输入或下拉选择", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await renderWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "测试数据" }));
  const copyButton = await screen.findByRole("button", {
    name: "复制数据编号 DP-000007",
  });
  expect(copyButton).toHaveAttribute("title", "复制编号");
  fireEvent.click(copyButton);
  expect(writeText).toHaveBeenCalledWith("DP-000007");

  fireEvent.click(screen.getByRole("button", { name: "测试组设置" }));
  fireEvent.click(await screen.findByRole("button", { name: "编辑设置" }));
  const packageSelect = await screen.findByLabelText("AUTO-000001 数据包");
  expect(packageSelect).toHaveAttribute("multiple");
  expect(
    await within(packageSelect).findByRole("option", { name: "DP-000007" }),
  ).toBeInTheDocument();
});

test("测试组名称仅在创建时填写且重新进入页签回到列表", async () => {
  await renderWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "测试组设置" }));
  fireEvent.click(await screen.findByRole("button", { name: "编辑设置" }));
  expect(await screen.findByText("测试组名称创建后不可修改")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "测试数据" }));
  fireEvent.click(screen.getByRole("button", { name: "测试组设置" }));
  expect(screen.queryByText("测试组名称创建后不可修改")).toBeNull();
  expect(
    await screen.findByRole("button", { name: "＋ 新建测试组" }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "＋ 新建测试组" }));
  expect(
    screen.getByText(/测试组名称仅可在创建时修改，创建后不支持修改/),
  ).toBeVisible();
  const nameInput = screen.getByRole("textbox", { name: "测试组名称" });
  fireEvent.change(nameInput, { target: { value: "EVT1 综合回归" } });
  fireEvent.click(screen.getByRole("button", { name: "创建测试组" }));

  expect(await screen.findByText("EVT1 综合回归")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "测试组名称" })).toBeNull();
  expect(screen.getByText("测试组名称创建后不可修改")).toBeVisible();
});

test("人工测试结果使用统一表格录入", async () => {
  await renderWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "执行与结果" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "进入人工结果录入" }),
  );

  expect(await screen.findByRole("table")).toHaveClass(
    "prototype-manual-table",
  );
  expect(screen.getByRole("columnheader", { name: "用例编号" })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "测试结果" })).toBeVisible();
  expect(
    await screen.findByRole("combobox", { name: "SRC-001 测试结果" }),
  ).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "SRC-001 实际结果" }),
  ).toBeVisible();
});

test("执行结果使用浅色测试组选择区并展示真实最终报告和 HTML 预览", async () => {
  await renderWorkspace();

  expect(screen.getByTestId("prototype-sidebar-brand-glyph")).toHaveClass(
    "prototype-brand-glyph",
  );
  fireEvent.click(screen.getByRole("button", { name: "执行与结果" }));

  expect(await screen.findByText("当前在线报告")).toBeVisible();
  expect(screen.getByText(/建议暂缓并补充验证/)).toBeVisible();
  expect(screen.getByText(/AI 区域状态：not_configured/)).toBeVisible();
  const previewButton = screen.getByRole("button", {
    name: "预览最新报告（HTML）",
  });
  expect(previewButton).toBeEnabled();

  fireEvent.click(previewButton);
  const previewDialog = await screen.findByRole("dialog", {
    name: "报告 #5 HTML 预览",
  });
  expect(
    within(previewDialog).getByRole("heading", { name: /最终测试报告/ }),
  ).toBeVisible();
  expect(
    within(previewDialog).getByRole("heading", { name: "AI 区域状态" }),
  ).toBeVisible();
  expect(screen.getByTitle("事实报告 HTML 预览")).toHaveAttribute(
    "src",
    "/api/fact-reports/5.html",
  );

  fireEvent.click(screen.getByRole("button", { name: "返回报告列表" }));
  const historyDialog = await screen.findByRole("dialog", {
    name: "历史报告列表",
  });
  expect(within(historyDialog).getByText("报告 #5")).toBeVisible();
  fireEvent.click(
    within(historyDialog).getByRole("button", { name: "预览报告 #5" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "报告 #5 HTML 预览" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭报告预览" }));
});
