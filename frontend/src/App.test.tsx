import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("测试工程师能在状态页看到后端和数据库可用", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", database: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]))),
  );

  render(<App />);

  expect(await screen.findByText("服务运行正常")).toBeInTheDocument();
  expect(screen.getByText("SQLite 可用")).toBeInTheDocument();
});

test("测试工程师能创建快速正常采集任务并重新查看", async () => {
  const createdTask = {
    id: 1,
    name: "面试快速正常采集",
    mode: "quick",
    scenario: "normal",
    status: "draft",
    created_at: "2026-08-22T12:00:00Z",
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(createdTask), { status: 201 }),
    );
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "面试快速正常采集" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(
    await screen.findByRole("heading", { name: "面试快速正常采集" }),
  ).toBeInTheDocument();
  expect(screen.getByText("快速 · 正常采集 · 草稿")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "面试快速正常采集",
        mode: "quick",
        scenario: "normal",
      }),
    }),
  );
});

test("页面刷新后能从公开 API 重新显示已保存采集任务", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", database: "ok" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 7,
              name: "已持久化任务",
              mode: "quick",
              scenario: "normal",
              status: "draft",
              created_at: "2026-08-22T12:00:00Z",
            },
          ]),
        ),
      ),
  );

  render(<App />);

  expect(
    await screen.findByRole("heading", { name: "已持久化任务" }),
  ).toBeInTheDocument();
  expect(screen.getByText("快速 · 正常采集 · 草稿")).toBeInTheDocument();
});

test("空白任务名称在前端被拒绝且不会调用保存 API", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])));
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  await screen.findByText("还没有采集任务。");
  fireEvent.change(screen.getByLabelText("任务名称"), {
    target: { value: "   " },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(screen.getByRole("alert")).toHaveTextContent("请输入任务名称");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
