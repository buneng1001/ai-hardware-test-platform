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

test("测试工程师能执行正常任务并查看运行阶段产物和检查结果", async () => {
  const task = {
    id: 3,
    name: "可执行正常任务",
    mode: "quick",
    scenario: "normal",
    status: "draft",
    created_at: "2026-08-22T12:00:00Z",
  };
  const completedRun = {
    id: 9,
    collection_task_id: 3,
    status: "completed",
    configuration_snapshot: {
      mode: "quick",
      scenario: "normal",
      duration_seconds: 2,
      video: {
        channels: 1,
        resolution: "640x360",
        fps: 15,
        container: "mp4",
        codec: "h264",
      },
      imu: { format: "csv", sample_rate_hz: 50 },
      random_seed: 20260822,
    },
    events: [
      "queued",
      "generating_data",
      "running_checks",
      "summarizing_results",
      "completed",
    ].map((stage) => ({ stage, occurred_at: "2026-08-22T12:00:00Z" })),
    artifacts: [
      {
        kind: "video",
        path: "runs/9/camera_1.mp4",
        source: "actual_generated",
        size_bytes: 1200,
        sha256: "a",
      },
      {
        kind: "imu",
        path: "runs/9/imu.csv",
        source: "actual_generated",
        size_bytes: 800,
        sha256: "b",
      },
    ],
    checks: [
      { name: "video_h264", status: "passed", message: "视频编码为 H.264" },
    ],
    created_at: "2026-08-22T12:00:00Z",
    completed_at: "2026-08-22T12:00:01Z",
    error: null,
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", database: "ok" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([task])))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...completedRun,
            status: "queued",
            events: completedRun.events.slice(0, 1),
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(completedRun), { status: 201 }),
      ),
  );

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "执行任务" }));

  expect(
    await screen.findByRole("heading", { name: "运行 #9" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("已完成")).toBeInTheDocument();
  expect(screen.getByText("进度：5/5（100%）")).toBeInTheDocument();
  expect(
    screen.getByText("排队 → 生成数据 → 执行检查 → 汇总结果 → 已完成"),
  ).toBeInTheDocument();
  expect(screen.getByText("camera_1.mp4 · 实际生成")).toBeInTheDocument();
  expect(screen.getByText("视频编码为 H.264")).toBeInTheDocument();
});

test("测试工程师能取消运行并从原配置创建新的运行记录", async () => {
  const task = {
    id: 4,
    name: "可取消任务",
    mode: "quick",
    scenario: "normal",
    status: "draft",
    created_at: "2026-08-22T12:00:00Z",
  };
  const queuedRun = {
    id: 10,
    collection_task_id: 4,
    status: "queued",
    configuration_snapshot: {
      mode: "quick",
      scenario: "normal",
      duration_seconds: 2,
      video: {
        channels: 1,
        resolution: "640x360",
        fps: 15,
        container: "mp4",
        codec: "h264",
      },
      imu: { format: "csv", sample_rate_hz: 50 },
      random_seed: 20260822,
    },
    events: [{ stage: "queued", occurred_at: "2026-08-22T12:00:00Z" }],
    artifacts: [],
    checks: [],
    created_at: "2026-08-22T12:00:00Z",
    completed_at: null,
    error: null,
  };
  const cancelledRun = {
    ...queuedRun,
    status: "cancelled",
    completed_at: "2026-08-22T12:00:01Z",
    events: [
      ...queuedRun.events,
      { stage: "cancelled", occurred_at: "2026-08-22T12:00:01Z" },
    ],
  };
  const rerun = { ...queuedRun, id: 11 };
  const pendingPoll = new Promise<Response>(() => undefined);
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === "/api/health")
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok", database: "ok" })),
      );
    if (url === "/api/collection-tasks")
      return Promise.resolve(new Response(JSON.stringify([task])));
    if (url === "/api/collection-tasks/4/runs") {
      return Promise.resolve(
        new Response(JSON.stringify(queuedRun), { status: 201 }),
      );
    }
    if (url === "/api/runs/10" && !init) return pendingPoll;
    if (url === "/api/runs/10/cancel")
      return Promise.resolve(new Response(JSON.stringify(cancelledRun)));
    if (url === "/api/runs/10/rerun")
      return Promise.resolve(
        new Response(JSON.stringify(rerun), { status: 201 }),
      );
    throw new Error(`未预期请求：${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "执行任务" }));
  fireEvent.click(await screen.findByRole("button", { name: "取消运行" }));

  expect(await screen.findByText("已取消")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新执行" }));
  expect(
    await screen.findByRole("heading", { name: "运行 #11" }),
  ).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/runs/10/rerun", {
    method: "POST",
  });
});
