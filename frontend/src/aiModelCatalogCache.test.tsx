import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PrototypeAiConfiguration } from "./V020PrototypeAiConfiguration";
import { readCachedCatalog, writeCachedCatalog } from "./aiModelCatalogCache";
import { jsonResponse } from "./v020ProjectFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("模型目录缓存可以按服务商写入和读取", () => {
  writeCachedCatalog("siliconflow", [
    { id: "m-1", label: "M1", availability: "verified" },
  ]);

  expect(readCachedCatalog("siliconflow")).toEqual([
    { id: "m-1", label: "M1", availability: "verified" },
  ]);
  expect(readCachedCatalog("deepseek")).toBeNull();
});

test("实时刷新的模型目录在组件重新挂载后仍然保留", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/settings/ai/config") {
        return jsonResponse({
          snapshot: null,
          catalog: null,
          verification: {
            status: "untested",
            message: "",
            fingerprint: null,
            error_kind: null,
            retryable: false,
            network_diagnostic: null,
            verified_at: null,
          },
          network_modes: ["auto", "system_proxy", "direct"],
        });
      }
      if (url === "/api/settings/ai/models/query") {
        return jsonResponse({
          provider: "deepseek",
          models: ["deepseek-flash", "brand-new-model"],
          source: "provider",
          warning: null,
        });
      }
      return jsonResponse({ detail: "未模拟的接口" }, 404);
    }),
  );

  const first = render(<PrototypeAiConfiguration onSkip={() => undefined} />);
  fireEvent.click(await screen.findByRole("button", { name: /刷新可用模型/ }));
  expect(
    await screen.findByText("已从 DeepSeek 实时获取 2 个可用模型。"),
  ).toBeVisible();
  first.unmount();

  // 重新挂载后应沿用缓存目录，而不是退回内置目录并重新显示“待实时校验”。
  render(<PrototypeAiConfiguration onSkip={() => undefined} />);
  expect(
    await screen.findByRole("option", { name: "brand-new-model" }),
  ).toBeInTheDocument();
});
