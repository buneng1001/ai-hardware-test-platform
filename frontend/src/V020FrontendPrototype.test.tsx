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
  const fetchMock = vi.fn().mockImplementation(
    async () =>
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
  expect(
    await screen.findByText(
      /连接成功：DeepSeek \/ DeepSeek-V4\.1-Flash：deepseek 连接可用/,
    ),
  ).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/settings/ai/test",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        provider: "deepseek",
        model: "deepseek-flash",
        api_key: "temporary-secret",
        key_source: "temporary",
        network_mode: "auto",
      }),
    }),
  );
});

test("AI 连接失败时明确显示失败状态", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            provider: "deepseek",
            model: "deepseek-flash",
            error_kind: "authentication",
            retryable: false,
            message: "模型服务鉴权失败，请检查 API Key",
            error: {
              stage: "connection_test",
              kind: "authentication",
              retryable: false,
              user_message: "模型服务鉴权失败，请检查 API Key",
              action: "检查 API Key 和账户状态后重新测试",
              diagnostic: null,
            },
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
  expect(
    screen.getByText("下一步：检查 API Key 和账户状态后重新测试"),
  ).toBeVisible();
});

test("AI 配置可从后端刷新服务商实时模型目录", async () => {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
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
        network_mode: "auto",
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
