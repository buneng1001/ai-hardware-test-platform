import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FrontendRoot } from "./FrontendRoot";
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
