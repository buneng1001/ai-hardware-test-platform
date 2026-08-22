import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("测试工程师能在状态页看到后端和数据库可用", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", database: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

  render(<App />);

  expect(await screen.findByText("服务运行正常")).toBeInTheDocument();
  expect(screen.getByText("SQLite 可用")).toBeInTheDocument();
});
