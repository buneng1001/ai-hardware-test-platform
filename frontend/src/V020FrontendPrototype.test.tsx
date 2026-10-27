import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FrontendRoot } from "./FrontendRoot";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
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

test("首页动效复用四方块品牌图形", () => {
  render(<FrontendRoot />);

  const brandMotion = screen.getByTestId("prototype-home-brand-motion");
  expect(brandMotion.children).toHaveLength(4);
  expect(brandMotion).toHaveClass("prototype-brand-glyph");
});

test("AI 配置支持临时密钥和本地接入方式切换", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        provider: "deepseek",
        model: "deepseek-flash",
        error_kind: null,
        retryable: false,
        message: "deepseek 连接可用",
      }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<FrontendRoot />);

  expect(screen.getByRole("combobox", { name: "服务商" })).toHaveValue(
    "deepseek",
  );
  expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue(
    "deepseek-flash",
  );
  expect(
    screen.getByText("后端配置 · DeepSeek / DeepSeek-V4.1-Flash"),
  ).toBeVisible();

  const temporaryKey = screen.getByLabelText("临时 API Key");
  const temporaryAccess = screen.getByRole("button", {
    name: "使用临时 API 接入",
  });
  expect(temporaryAccess).toBeDisabled();
  fireEvent.change(temporaryKey, { target: { value: "temporary-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "清除临时 API" }));
  expect(temporaryKey).toHaveValue("");

  fireEvent.change(temporaryKey, { target: { value: "temporary-secret" } });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "本次会话记住临时 API" }),
  );
  expect(window.sessionStorage.getItem("iris-test-temporary-ai-key")).toBe(
    "temporary-secret",
  );
  fireEvent.click(temporaryAccess);
  expect(
    screen.getByText("临时 API · DeepSeek / DeepSeek-V4.1-Flash"),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "AI 连接测试" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "连接成功：DeepSeek / DeepSeek-V4.1-Flash：deepseek 连接可用",
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/settings/ai/test",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        provider: "deepseek",
        model: "deepseek-flash",
        api_key: "temporary-secret",
      }),
    }),
  );
});

test("AI 连接失败时明确显示失败状态", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          provider: "deepseek",
          model: "deepseek-flash",
          error_kind: "authentication",
          retryable: false,
          message: "模型服务鉴权失败，请检查 API Key",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  render(<FrontendRoot />);

  fireEvent.click(screen.getByRole("button", { name: "AI 连接测试" }));

  const feedback = await screen.findByRole("alert");
  expect(feedback).toHaveTextContent(
    "连接失败：DeepSeek / DeepSeek-V4.1-Flash：模型服务鉴权失败，请检查 API Key",
  );
  expect(feedback).toHaveClass("prototype-ai-feedback-error");
});

test("AI 配置可从后端刷新服务商实时模型目录", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        provider: "siliconflow",
        models: [
          "deepseek-ai/DeepSeek-V4.1-Flash",
          "zai-org/GLM-5.2",
          "new-provider/Latest-Model",
        ],
        source: "provider",
        warning: null,
      }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<FrontendRoot />);

  expect(
    screen.getByRole("option", { name: "DeepSeek-V4.1-Flash" }),
  ).toHaveValue("deepseek-flash");
  expect(screen.getByRole("option", { name: "DeepSeek-V4-Pro" })).toHaveValue(
    "deepseek-v4-pro",
  );

  fireEvent.change(screen.getByRole("combobox", { name: "服务商" }), {
    target: { value: "siliconflow" },
  });
  expect(
    screen.getByRole("option", { name: /MiniMax-M3\.1-Flash/ }),
  ).toBeVisible();
  expect(screen.getByRole("option", { name: /Kimi-K3/ })).toBeVisible();
  expect(screen.getByRole("option", { name: "GLM-5.2" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Qwen3.6-27B" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "刷新可用模型" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "已从 SiliconFlow 实时获取 3 个可用模型",
  );
  expect(
    screen.getByRole("option", { name: "new-provider/Latest-Model" }),
  ).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/settings/ai/models/query",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        provider: "siliconflow",
        api_key: "",
      }),
    }),
  );
});

test("首页和项目列表进入下一页时使用统一页面切换容器", () => {
  render(<FrontendRoot />);

  expect(screen.getByTestId("prototype-screen-transition")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  expect(screen.getByRole("heading", { name: "项目列表" })).toBeVisible();
  expect(screen.getByTestId("prototype-screen-transition")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /IRIS 头环/ }));
  expect(
    screen.getByRole("heading", { name: "EVT1 测试工作区" }),
  ).toBeVisible();
  expect(screen.getByTestId("prototype-screen-transition")).toBeVisible();
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
  expect(screen.getByRole("button", { name: "导入用例表" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Beta/i })).toBeNull();

  const moduleFilter = screen.getByRole("combobox", { name: "用例模块" });
  expect(moduleFilter.tagName).toBe("BUTTON");
  expect(moduleFilter).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(moduleFilter);
  expect(screen.getByRole("listbox", { name: "用例模块" })).toBeVisible();
  expect(screen.getByRole("option", { name: "全部模块" })).toBeVisible();
  expect(screen.getByRole("option", { name: "录制功能" })).toBeVisible();
  fireEvent.click(screen.getByRole("option", { name: "电源管理" }));
  expect(moduleFilter).toHaveAttribute("aria-expanded", "false");
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

test("执行结果使用浅色测试组选择区并展示 AI 回测建议和统一报告预览入口", () => {
  renderWorkspace();

  expect(screen.getByTestId("prototype-sidebar-brand-glyph")).toHaveClass(
    "prototype-brand-glyph",
  );
  fireEvent.click(screen.getByRole("button", { name: "执行与结果" }));

  expect(screen.getByText(/AI 回测建议：/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "预览最新报告（HTML）" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "下载 HTML" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "查看报告列表" }));
  expect(screen.getByRole("dialog", { name: "历史报告列表" })).toBeVisible();
  expect(screen.getByText("报告 #003")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "预览报告 #003" }));
  expect(
    screen.getByRole("dialog", { name: "最新报告 HTML 预览" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: /最终测试报告/ })).toBeVisible();
  expect(screen.getByText("AI 回测建议", { selector: "h3" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "返回报告列表" }));
  fireEvent.click(screen.getByRole("button", { name: "预览报告 #002" }));
  expect(
    screen.getByRole("dialog", { name: "报告 #002 HTML 预览" }),
  ).toBeVisible();
  expect(screen.getByText("待回归")).toBeVisible();
  expect(screen.getByText(/文件索引未正确重建/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭报告预览" }));

  fireEvent.click(screen.getByRole("button", { name: "预览最新报告（HTML）" }));
  expect(
    screen.getByRole("dialog", { name: "最新报告 HTML 预览" }),
  ).toBeVisible();
});
