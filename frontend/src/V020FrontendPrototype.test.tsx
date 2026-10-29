import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { FrontendRoot } from "./FrontendRoot";

const prototypeProject = {
  id: 1,
  name: "IRIS 头环",
  product_name: "多传感器记录设备",
  description: "Beta 测试项目",
  product_version_count: 1,
  created_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-02T08:00:00Z",
};

const prototypeVersion = {
  id: 11,
  project_id: 1,
  version: "EVT1",
  name: "",
  description: "",
  created_at: "2026-10-01T08:10:00Z",
  updated_at: "2026-10-01T08:10:00Z",
};

/** 冻结版“测试用例表”页读取的真实原始用例样例。 */
const prototypeSourceCases = [
  {
    id: 1,
    import_record_id: 1,
    source_import_status: "active",
    case_number: "TC-REC-001",
    title: "短按录制键，确认开始录制",
    priority: "高",
    preconditions: "",
    input: "",
    steps: "确认设备处于待机状态\n短按录制键并观察录制指示",
    expected_result: "",
    test_type: "",
    module: "录制功能",
    test_item: "录制启动",
    test_result: "",
    test_record: "",
    pre_test_notes: "",
    planned_execution_time: "",
    attachment: "",
    software_version: "EVT1-0.2.0",
    selected: false,
  },
  {
    id: 2,
    import_record_id: 1,
    source_import_status: "active",
    case_number: "TC-POWER-003",
    title: "设备断电后数据保存状态",
    priority: "中",
    preconditions: "",
    input: "",
    steps: "在设备录制过程中断开电源",
    expected_result: "",
    test_type: "",
    module: "电源管理",
    test_item: "断电恢复",
    test_result: "",
    test_record: "",
    pre_test_notes: "",
    planned_execution_time: "",
    attachment: "",
    software_version: "EVT1-0.2.0",
    selected: false,
  },
];

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 冻结页面进入项目后需要的最小项目、版本与趋势数据。 */
function stubProjectApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/projects?"))
        return jsonResponse([prototypeProject]);
      if (url === "/api/projects/1")
        return jsonResponse({
          ...prototypeProject,
          product_versions: [prototypeVersion],
        });
      if (url === "/api/projects/1/trends")
        return jsonResponse({
          project_id: 1,
          status: "empty",
          message: "尚无最终报告",
          points: [],
        });
      if (url.startsWith("/api/product-versions/11/source-test-cases")) {
        const query = new URL(url, "http://local").searchParams;
        const moduleFilter = query.get("module");
        return jsonResponse({
          items: moduleFilter
            ? prototypeSourceCases.filter(
                (item) => item.module === moduleFilter,
              )
            : prototypeSourceCases,
        });
      }
      if (url === "/api/product-versions/11/source-test-case-imports")
        return jsonResponse([]);
      return jsonResponse({ detail: "未模拟的接口" }, 404);
    }),
  );
}

beforeEach(() => {
  stubProjectApi();
});

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

test("首页和项目列表进入下一页时使用统一页面切换容器", async () => {
  render(<FrontendRoot />);

  expect(screen.getByTestId("prototype-screen-transition")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  expect(screen.getByRole("heading", { name: "项目列表" })).toBeVisible();
  expect(screen.getByTestId("prototype-screen-transition")).toBeVisible();

  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));
  expect(
    await screen.findByRole("heading", { name: "EVT1 测试工作区" }),
  ).toBeVisible();
  expect(screen.getByTestId("prototype-screen-transition")).toBeVisible();
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

test("测试组名称仅在创建时填写且重新进入页签回到列表", async () => {
  await renderWorkspace();

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

test("人工测试结果使用统一表格录入", async () => {
  await renderWorkspace();

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

test("执行结果使用浅色测试组选择区并展示 AI 回测建议和统一报告预览入口", async () => {
  await renderWorkspace();

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
