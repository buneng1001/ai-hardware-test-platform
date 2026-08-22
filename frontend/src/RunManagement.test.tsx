import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const task = {
  id: 3,
  name: "可执行正常任务",
  mode: "quick",
  scenario: "normal",
  status: "draft",
  created_at: "2026-08-22T12:00:00Z",
};

const queuedRun = {
  id: 9,
  collection_task_id: 3,
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

test("测试工程师能执行正常任务并查看运行阶段产物和检查结果", async () => {
  const completedRun = {
    ...queuedRun,
    status: "completed",
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
    ],
    checks: [
      { name: "video_h264", status: "passed", message: "视频编码为 H.264" },
    ],
    completed_at: "2026-08-22T12:00:01Z",
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
        new Response(JSON.stringify(queuedRun), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(completedRun))),
  );
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "执行任务" }));
  expect(await screen.findByText("已完成")).toBeInTheDocument();
  expect(screen.getByText("进度：5/5（100%）")).toBeInTheDocument();
  expect(
    screen.getByText("排队 → 生成数据 → 执行检查 → 汇总结果 → 已完成"),
  ).toBeInTheDocument();
  expect(screen.getByText("camera_1.mp4 · 实际生成")).toBeInTheDocument();
  expect(screen.getByText("视频编码为 H.264")).toBeInTheDocument();
});

test("测试工程师能取消运行并从原配置创建新的运行记录", async () => {
  const cancellableTask = { ...task, id: 4, name: "可取消任务" };
  const cancellableRun = { ...queuedRun, id: 10, collection_task_id: 4 };
  const cancelledRun = {
    ...cancellableRun,
    status: "cancelled",
    completed_at: "2026-08-22T12:00:01Z",
    events: [
      ...cancellableRun.events,
      { stage: "cancelled", occurred_at: "2026-08-22T12:00:01Z" },
    ],
  };
  const rerun = { ...cancellableRun, id: 11 };
  const pendingPoll = new Promise<Response>(() => undefined);
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === "/api/health") {
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok", database: "ok" })),
      );
    }
    if (url === "/api/collection-tasks") {
      return Promise.resolve(new Response(JSON.stringify([cancellableTask])));
    }
    if (url === "/api/collection-tasks/4/runs") {
      return Promise.resolve(
        new Response(JSON.stringify(cancellableRun), { status: 201 }),
      );
    }
    if (url === "/api/runs/10" && !init) return pendingPoll;
    if (url === "/api/runs/10/cancel")
      return Promise.resolve(new Response(JSON.stringify(cancelledRun)));
    if (url === "/api/runs/10/rerun") {
      return Promise.resolve(
        new Response(JSON.stringify(rerun), { status: 201 }),
      );
    }
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
