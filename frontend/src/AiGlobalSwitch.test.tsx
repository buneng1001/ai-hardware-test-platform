import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { AiGlobalSwitch } from "./AiGlobalSwitch";
import { PrototypeHome } from "./V020PrototypeEntryScreens";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("全局开关由后端决定；跨组件读取同一状态且错误不误开启", async () => {
  let enabled = false;
  let verified = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/settings/ai/active-invocation"))
      return new Response(JSON.stringify({ active: null }));
    if (!url.includes("/api/settings/ai/state"))
      throw new Error(`unexpected request ${url}`);
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { enabled: boolean };
      if (body.enabled && !verified)
        return new Response(JSON.stringify({ detail: "请先验证正式配置" }), {
          status: 409,
        });
      enabled = body.enabled;
    }
    return new Response(
      JSON.stringify({
        enabled,
        can_enable: verified,
        reason: verified ? null : "请先验证正式配置",
        provider: "deepseek",
        model: "deepseek-flash",
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<AiGlobalSwitch />);
  await screen.findByText("AI 已关闭");
  fireEvent.click(screen.getByRole("button", { name: "开启 AI" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "请先验证正式配置",
  );
  expect(screen.getByText("AI 已关闭")).toBeVisible();
  verified = true;
  fireEvent.click(screen.getByRole("button", { name: "开启 AI" }));
  expect(await screen.findByText(/AI 已开启 · deepseek/)).toBeVisible();

  // 新挂载实例读取服务端持久状态，而不是读取同标签的本地状态。
  cleanup();
  render(<AiGlobalSwitch />);
  expect(await screen.findByText(/AI 已开启 · deepseek/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭 AI" }));
  await waitFor(() => expect(enabled).toBe(false));
});

test("关闭时存在活动调用只显示双选项；确认停止后等待活动调用结束", async () => {
  let enabled = true;
  let active: {
    invocation_id: string;
    operation_type: string;
    display_name: string;
    project_id: number | null;
    project_name: string | null;
    resource_id: number | null;
    status: "running";
    stopping: boolean;
    started_at: string;
    cancel_requested_at: string | null;
    config_fingerprint: string;
    execution_mode: "single_request";
    input_fingerprint: string | null;
  } | null = {
    invocation_id: "invoke-1",
    operation_type: "report_analysis",
    display_name: "最终报告 AI 总体分析",
    project_id: 9,
    project_name: "项目九",
    resource_id: 12,
    status: "running",
    stopping: false,
    started_at: "2026-11-23T10:00:00Z",
    cancel_requested_at: null,
    config_fingerprint: "fingerprint",
    execution_mode: "single_request",
    input_fingerprint: null,
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/settings/ai/state")
      return new Response(
        JSON.stringify({
          enabled,
          can_enable: true,
          reason: null,
          provider: "deepseek",
          model: "deepseek-flash",
        }),
      );
    if (url === "/api/settings/ai/active-invocation")
      return new Response(JSON.stringify({ active }));
    if (url.endsWith("/stop-and-disable") && init?.method === "POST") {
      if (active)
        active = { ...active, stopping: true, cancel_requested_at: "now" };
      return new Response(JSON.stringify({ active, enabled: true }));
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<AiGlobalSwitch />);
  await screen.findByText(/AI 已开启/);
  fireEvent.click(screen.getByRole("button", { name: "关闭 AI" }));
  expect(await screen.findByRole("dialog")).toBeVisible();
  expect(screen.getByText(/最终报告 AI 总体分析/)).toBeVisible();
  expect(screen.getByText(/项目九/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "取消这次关闭操作" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(enabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "关闭 AI" }));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "停止当前的AI运行" }));
  expect(await screen.findByText(/正在停止当前 AI 运行/)).toBeVisible();
  expect(enabled).toBe(true);
  active = null;
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), {
    timeout: 3000,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/settings/ai/invocations/invoke-1/stop-and-disable",
    expect.objectContaining({ method: "POST" }),
  );
});

test("首页进入不依赖 AI 准入；后端仍拒绝未验证的开启", async () => {
  const onOpen = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/settings/ai/config")
        return new Response(
          JSON.stringify({
            snapshot: null,
            verification: { status: "untested" },
          }),
        );
      if (url === "/api/settings/ai/state") {
        if (init?.method === "PUT")
          return new Response(JSON.stringify({ detail: "未完成验证" }), {
            status: 409,
          });
        return new Response(
          JSON.stringify({
            enabled: Boolean(init?.method === "PUT"),
            can_enable: false,
            reason: "未完成验证",
            provider: "deepseek",
            model: "deepseek-flash",
          }),
        );
      }
      return new Response("{}", { status: 200 });
    }),
  );
  render(<PrototypeHome onOpenProjects={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
});
