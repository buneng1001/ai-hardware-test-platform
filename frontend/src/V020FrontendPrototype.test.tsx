import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FrontendRoot } from "./FrontendRoot";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

test("首页使用固定两行产品标题和完整测试工作流副标题", () => {
  render(<FrontendRoot />);

  const heading = screen.getByRole("heading", {
    name: "智能硬件自动化测试平台",
  });
  expect(heading.children).toHaveLength(2);
  expect(heading.children[0]).toHaveTextContent("智能硬件");
  expect(heading.children[1]).toHaveTextContent("自动化测试平台");
  expect(
    screen.getByText(
      "覆盖测试用例、数据管理、自动化执行、结果验证与智能诊断的完整测试工作流。",
    ),
  ).toBeVisible();
});

function renderWorkspace() {
  render(<FrontendRoot />);
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  fireEvent.click(screen.getByRole("button", { name: /IRIS 头环/ }));
}

test("工作区侧边栏可以折叠并在前端保存状态", () => {
  renderWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
  expect(screen.getByTestId("prototype-workspace-shell")).toHaveClass(
    "prototype-shell--collapsed",
  );
  expect(window.localStorage.getItem("iris-test-sidebar-collapsed")).toBe(
    "true",
  );
  expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
});

test("浏览器存储不可用时侧边栏仍可进入和折叠", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("storage blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("storage blocked", "SecurityError");
  });

  renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));

  expect(screen.getByTestId("prototype-workspace-shell")).toHaveClass(
    "prototype-shell--collapsed",
  );
});

test("用例表支持按模块筛选并展示测试步骤和加入测试组入口", () => {
  renderWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "需求 / 测试用例" }));
  fireEvent.click(screen.getByRole("button", { name: "测试用例表" }));

  expect(screen.getByRole("columnheader", { name: "测试步骤" })).toBeVisible();
  expect(screen.getByText("确认设备处于待机状态")).toBeVisible();
  expect(screen.getByRole("button", { name: "加入测试组" })).toBeVisible();

  fireEvent.change(screen.getByRole("combobox", { name: "用例模块" }), {
    target: { value: "电源管理" },
  });
  expect(screen.getByText("设备断电后数据保存状态")).toBeVisible();
  expect(screen.queryByText("短按录制键，确认开始录制")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "加入测试组" }));
  expect(screen.getByRole("heading", { name: "测试组设置" })).toBeVisible();
  expect(screen.getByRole("button", { name: "＋ 新建测试组" })).toBeVisible();
});

test("测试数据支持复制编号且测试组数据包可输入或下拉选择", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  renderWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "测试数据" }));
  const copyButton = screen.getByRole("button", {
    name: "复制数据编号 DP-REC-001",
  });
  expect(copyButton).toHaveAttribute("title", "复制编号");
  fireEvent.click(copyButton);
  expect(writeText).toHaveBeenCalledWith("DP-REC-001");

  fireEvent.click(screen.getByRole("button", { name: "测试组设置" }));
  fireEvent.click(screen.getAllByRole("button", { name: "编辑设置" })[0]);
  const dataPackageInput = screen.getByRole("combobox", {
    name: "数据包 TC-REC-001",
  });
  expect(dataPackageInput).toHaveAttribute(
    "list",
    "prototype-data-packages-TC-REC-001",
  );
  fireEvent.change(dataPackageInput, {
    target: { value: "DP-CUSTOM-009 自定义录制数据" },
  });
  expect(dataPackageInput).toHaveValue("DP-CUSTOM-009 自定义录制数据");
});

test("测试组名称仅在创建时填写且重新进入页签回到列表", () => {
  renderWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "测试组设置" }));
  fireEvent.click(screen.getAllByRole("button", { name: "编辑设置" })[0]);
  expect(screen.getByText("测试组名称创建后不可修改")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "测试数据" }));
  fireEvent.click(screen.getByRole("button", { name: "测试组设置" }));
  expect(screen.queryByText("测试组名称创建后不可修改")).toBeNull();
  expect(screen.getByRole("button", { name: "＋ 新建测试组" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "＋ 新建测试组" }));
  expect(
    screen.getByText(/测试组名称仅可在创建时修改，创建后不支持修改/),
  ).toBeVisible();
  const nameInput = screen.getByRole("textbox", { name: "测试组名称" });
  fireEvent.change(nameInput, { target: { value: "EVT1 综合回归" } });
  fireEvent.click(screen.getByRole("button", { name: "创建测试组" }));

  expect(screen.getByText("EVT1 综合回归")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "测试组名称" })).toBeNull();
  expect(screen.getByText("测试组名称创建后不可修改")).toBeVisible();
});

test("人工测试结果使用统一表格录入", () => {
  renderWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "执行与结果" }));
  fireEvent.click(screen.getByRole("button", { name: "进入人工结果录入" }));

  expect(screen.getByRole("table")).toHaveClass("prototype-manual-table");
  expect(screen.getByRole("columnheader", { name: "用例编号" })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "测试步骤" })).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "TC-REC-001 测试结果" }),
  ).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "TC-REC-001 测试记录" }),
  ).toBeVisible();
});
