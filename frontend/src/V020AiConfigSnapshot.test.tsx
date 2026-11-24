import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FrontendRoot } from "./FrontendRoot";
import { PrototypeHome } from "./V020PrototypeEntryScreens";
import type { AiConfigState } from "./aiSettingsApi";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function configState(overrides: Partial<AiConfigState> = {}): AiConfigState {
  return {
    snapshot: {
      provider: "deepseek",
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-flash",
      key_source: "environment",
      network_mode: "auto",
      prompt_version: "diagnosis-v1",
      fingerprint: "fingerprint-1",
      created_at: "2026-10-30T10:00:00+00:00",
    },
    catalog: {
      provider: "deepseek",
      models: ["deepseek-flash"],
      source: "provider",
      warning: null,
      fetched_at: "2026-10-30T10:00:00+00:00",
      selected_model: "deepseek-flash",
      selected_model_available: true,
    },
    verification: {
      status: "verified",
      message: "deepseek 连接可用",
      fingerprint: "fingerprint-1",
      error_kind: null,
      retryable: false,
      network_diagnostic: null,
      verified_at: "2026-10-30T10:00:00+00:00",
    },
    network_modes: ["auto", "system_proxy", "direct"],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test.each(["success", "verification-failed", "enable-failed"] as const)(
  "首页连接测试与保存开启流程：%s",
  async (outcome) => {
    const initial = configState();
    let saved = initial;
    let enabled = false;
    let testCount = 0;
    const stateWrites: boolean[] = [];
    const onOpenProjects = vi.fn();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/settings/ai/config") {
          if (init?.method === "POST") {
            saved = configState({
              snapshot: {
                ...initial.snapshot!,
                network_mode: "direct",
                fingerprint: "fingerprint-2",
              },
              verification: {
                ...initial.verification,
                status: "invalidated",
                fingerprint: "fingerprint-2",
              },
            });
            enabled = false;
          }
          return jsonResponse(saved);
        }
        if (url === "/api/settings/ai/test") {
          testCount += 1;
          const ok = testCount === 1 || outcome !== "verification-failed";
          if (testCount > 1) {
            saved = {
              ...saved,
              verification: {
                ...saved.verification,
                status: ok ? "verified" : "failed",
                message: ok ? "正式连接可用" : "正式连接失败",
              },
            };
          }
          return jsonResponse({
            ok,
            provider: "deepseek",
            model: "deepseek-flash",
            message: ok ? "连接可用" : "正式连接失败",
            config_fingerprint: "fingerprint-2",
          });
        }
        if (url === "/api/settings/ai/state") {
          if (init?.method === "PUT") {
            const body = JSON.parse(String(init.body)) as { enabled: boolean };
            stateWrites.push(body.enabled);
            expect(saved.verification.status).toBe("verified");
            if (outcome === "enable-failed") {
              return new Response(JSON.stringify({ detail: "开启失败" }), {
                status: 409,
              });
            }
            enabled = body.enabled;
          }
          return jsonResponse({
            enabled,
            can_enable: saved.verification.status === "verified",
            reason: null,
            provider: "deepseek",
            model: "deepseek-flash",
          });
        }
        if (url === "/api/settings/ai/active-invocation")
          return jsonResponse({ active: null });
        throw new Error(`unexpected request ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<PrototypeHome onOpenProjects={onOpenProjects} />);
    await screen.findByText("AI 已关闭");
    await screen.findByText(/验证状态：已验证/);
    fireEvent.change(screen.getByRole("combobox", { name: "网络方式" }), {
      target: { value: "direct" },
    });
    fireEvent.click(screen.getByRole("button", { name: "AI 连接测试" }));
    await screen.findByText(/连接成功：DeepSeek/);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "保存 AI 配置" }),
      ).toBeEnabled(),
    );
    expect(stateWrites).toEqual([]);
    expect(screen.getByText("AI 已关闭")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存 AI 配置" }));
    if (outcome === "success") {
      await screen.findByText("AI 配置已保存，AI 已开启。");
      expect(await screen.findByText("AI 已开启")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "关闭 AI，仅使用基础功能" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "暂不配置，进入平台" }),
      ).not.toBeInTheDocument();
      expect(stateWrites).toEqual([true]);
    } else {
      await screen.findByText(
        outcome === "verification-failed"
          ? /AI 配置已保存，但正式连接验证失败/
          : /AI 配置已保存，但开启 AI 失败/,
      );
      expect(screen.getByText("AI 已关闭")).toBeVisible();
      expect(stateWrites).toEqual(
        outcome === "verification-failed" ? [] : [true],
      );
    }
    expect(testCount).toBe(2);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开启平台" })).toBeEnabled(),
    );
    const beforeEntry = [...stateWrites];
    fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
    expect(onOpenProjects).toHaveBeenCalledOnce();
    expect(stateWrites).toEqual(beforeEntry);
  },
);

test("恢复已保存 AI 配置，变更即失效并可保存和确认目录缺项", async () => {
  let savedBody: unknown = null;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/settings/ai/config" && !init?.method)
        return jsonResponse(configState());
      if (url === "/api/settings/ai/config" && init?.method === "POST") {
        savedBody = JSON.parse(String(init.body));
        return jsonResponse(configState());
      }
      if (url === "/api/settings/ai/models/query")
        return jsonResponse({
          provider: "deepseek",
          models: ["deepseek-v4-pro"],
          source: "provider",
          warning: null,
        });
      if (url === "/api/settings/ai/test")
        return jsonResponse({
          ok: true,
          provider: "deepseek",
          model: "deepseek-flash",
          error_kind: null,
          retryable: false,
          message: "连接可用",
          config_fingerprint: "fingerprint-2",
        });
      return jsonResponse({ detail: "未模拟" });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<FrontendRoot />);

  expect(await screen.findByText(/验证状态：已验证/)).toBeVisible();
  expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue(
    "deepseek-flash",
  );
  expect(screen.getByRole("combobox", { name: "网络方式" })).toHaveValue(
    "auto",
  );

  fireEvent.change(screen.getByRole("combobox", { name: "网络方式" }), {
    target: { value: "direct" },
  });
  expect(screen.getByText(/验证状态：验证已失效/)).toBeVisible();
  expect(screen.getByText(/配置已修改，请重新测试/)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "保存 AI 配置" }));
  expect(await screen.findByText(/AI 配置已保存/)).toBeVisible();
  expect(savedBody).toEqual(
    expect.objectContaining({
      provider: "deepseek",
      model: "deepseek-flash",
      key_source: "environment",
      network_mode: "direct",
    }),
  );

  fireEvent.click(screen.getByRole("button", { name: "刷新可用模型" }));
  expect(
    await screen.findByText(
      "当前模型 deepseek-flash 不在最新目录中，请手动确认或更换模型。",
    ),
  ).toBeVisible();
  expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue(
    "deepseek-flash",
  );

  fireEvent.click(screen.getByRole("button", { name: "AI 连接测试" }));
  await screen.findByText(/连接成功：DeepSeek/);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/settings/ai/test",
    expect.objectContaining({
      body: expect.stringContaining('"network_mode":"direct"'),
    }),
  );
});

test("正式配置保存遇到活动 AI 调用时显示双选项且取消不触发停止或保存", async () => {
  const active = {
    invocation_id: "config-lock-1",
    operation_type: "diagnosis",
    display_name: "运行后诊断",
    project_id: 4,
    project_name: "配置锁测试项目",
    resource_id: 21,
    status: "running",
    stopping: false,
    started_at: "2026-11-23T10:00:00Z",
    cancel_requested_at: null,
    config_fingerprint: "fingerprint-1",
    execution_mode: "single_request",
    input_fingerprint: null,
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/settings/ai/config" && !init?.method)
        return jsonResponse(configState());
      if (url === "/api/settings/ai/config" && init?.method === "POST")
        return new Response(
          JSON.stringify({
            detail: "当前 AI 运行仍在进行，暂不能保存正式配置",
          }),
          { status: 409 },
        );
      if (url === "/api/settings/ai/active-invocation")
        return jsonResponse({ active });
      return new Response(JSON.stringify({ detail: "未模拟" }), {
        status: 404,
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<FrontendRoot />);
  expect(await screen.findByText(/验证状态：已验证/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "保存 AI 配置" }));
  expect(await screen.findByRole("dialog")).toBeVisible();
  expect(screen.getByText(/运行后诊断/)).toBeVisible();
  expect(screen.getByText(/配置锁测试项目/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "取消本次配置修改" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url) === "/api/settings/ai/config" && init?.method === "POST",
    ),
  ).toHaveLength(1);
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).includes("stop-and-disable"),
    ),
  ).toBe(false);
});

test("独立测试不同模型不能让未保存表单显示正式验证通过", async () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/settings/ai/test")
        return jsonResponse({
          ok: true,
          provider: "deepseek",
          model: "deepseek-v4-pro",
          message: "独立测试通过",
          config_fingerprint: "fingerprint-b",
        });
      if (url === "/api/settings/ai/config" && !init?.method)
        return jsonResponse(configState());
      return jsonResponse({ detail: "未模拟" });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<FrontendRoot />);
  expect(await screen.findByText(/验证状态：已验证/)).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "模型" }), {
    target: { value: "deepseek-v4-pro" },
  });
  expect(screen.getByText(/验证状态：验证已失效/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "AI 连接测试" }));
  expect(await screen.findByText(/连接成功：DeepSeek/)).toBeVisible();
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([url]) => url !== "/api/settings/ai/state"),
    ).toHaveLength(3),
  );
  expect(screen.getByText(/验证状态：验证已失效/)).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalledWith(
    "/api/settings/ai/config",
    expect.objectContaining({ method: "POST" }),
  );
});
