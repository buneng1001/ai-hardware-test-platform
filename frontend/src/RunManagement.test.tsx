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
  manual_check_results: [],
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
  expect(
    screen.getByRole("link", { name: "打开独立 HTML 报告" }),
  ).toHaveAttribute("href", "/api/runs/9/report.html");
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

test("运行详情展示掉帧失败指标、异常窗口和故障真值命中", async () => {
  const videoDropTask = { ...task, name: "掉帧任务", scenario: "video_drop" };
  const completedRun = {
    ...queuedRun,
    status: "completed",
    configuration_snapshot: {
      ...queuedRun.configuration_snapshot,
      scenario: "video_drop",
    },
    events: [
      "queued",
      "generating_data",
      "running_checks",
      "summarizing_results",
      "completed",
    ].map((stage) => ({ stage, occurred_at: "2026-08-22T12:00:00Z" })),
    checks: [
      {
        name: "video_frame_drop",
        category: "video",
        status: "failed",
        message: "第 1 路视频在 0.800～1.200 秒检测到 6 帧缺失",
        metrics: {
          channel: 1,
          expected_frames: 30,
          actual_frames: 24,
          dropped_frames: 6,
        },
        anomaly_windows: [{ channel: 1, start_s: 0.8, end_s: 1.2 }],
        truth_comparison: "matched",
      },
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
      .mockResolvedValueOnce(new Response(JSON.stringify([videoDropTask])))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(queuedRun), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(completedRun))),
  );

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "执行任务" }));

  expect(
    await screen.findByText("第 1 路视频在 0.800～1.200 秒检测到 6 帧缺失"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("失败指标：预期 30 帧，实际 24 帧，缺失 6 帧"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("异常时间窗口：第 1 路 0.800～1.200 秒"),
  ).toBeInTheDocument();
  expect(screen.getByText("故障真值对照：命中")).toBeInTheDocument();
});

test("运行详情展示 IMU 异常指标、位置和故障真值命中", async () => {
  const imuTask = { ...task, name: "IMU 异常任务", scenario: "imu_anomaly" };
  const completedRun = {
    ...queuedRun,
    status: "completed",
    configuration_snapshot: {
      ...queuedRun.configuration_snapshot,
      scenario: "imu_anomaly",
    },
    checks: [
      {
        name: "imu_missing_samples",
        category: "imu",
        status: "failed",
        message: "IMU 丢样检测到 1 处异常",
        metrics: { count: 1 },
        anomaly_windows: [{ sample_index: 24 }],
        truth_comparison: "matched",
      },
      {
        name: "imu_interval_distribution",
        category: "imu",
        status: "failed",
        message: "IMU 采样间隔检测到 4 个异常",
        metrics: {
          minimum_interval_ms: -20,
          maximum_interval_ms: 60,
          mean_interval_ms: 20,
          p95_interval_ms: 20,
          outlier_count: 4,
        },
        anomaly_windows: [
          { sample_index: 25 },
          { sample_index: 54 },
          { sample_index: 82 },
          { sample_index: 83 },
        ],
        truth_comparison: "matched",
      },
    ],
    completed_at: "2026-08-23T12:00:01Z",
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", database: "ok" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([imuTask])))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(queuedRun), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(completedRun))),
  );

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "执行任务" }));

  expect(
    await screen.findByText("IMU 丢样检测到 1 处异常"),
  ).toBeInTheDocument();
  expect(screen.getByText("异常位置：样本 #24")).toBeInTheDocument();
  expect(screen.getAllByText("故障真值对照：命中")).toHaveLength(2);
  expect(
    screen.getByText(
      "间隔分布：最小 -20 ms，最大 60 ms，平均 20 ms，P95 20 ms，异常 4 个",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText("异常位置：样本 #25、样本 #54、样本 #82、样本 #83"),
  ).toBeInTheDocument();
});

test("运行详情可查看并提交锚点复核且独立展示内容同步", async () => {
  const completedRun = {
    ...queuedRun,
    status: "completed",
    configuration_snapshot: {
      ...queuedRun.configuration_snapshot,
      scenario: "linear_drift",
      reference_channel: "camera_1",
    },
    events: [
      "queued",
      "generating_data",
      "running_checks",
      "summarizing_results",
      "completed",
    ].map((stage) => ({ stage, occurred_at: "2026-08-22T12:00:00Z" })),
    alignment_result: {
      reference_channel: "camera_1",
      method: "linear_drift_regression",
      parameters: { camera_1: 0, camera_4: -0.08 },
      drift_rates_s_per_s: { camera_1: 0, camera_4: -0.03 },
      anchors: { camera_1: [1, 2, 3] },
      pre_alignment: {
        camera_4: { offset_s: 0.08, jitter_ms: 2, drift_s_per_s: 0.03 },
      },
      post_alignment: {
        camera_4: {
          max_residual_ms: 10,
          mean_residual_ms: 4,
          p95_residual_ms: 9,
        },
      },
      trend: { camera_4: [1, 2, 3] },
      anchor_details: [
        {
          id: "camera_4:event-0",
          channel: "camera_4",
          event_index: 0,
          detected_time_s: 1.08,
          reviewed_time_s: 1.08,
          included: true,
          source: "video_flash",
        },
        {
          id: "imu:event-0",
          channel: "imu",
          event_index: 0,
          detected_time_s: 1.04,
          reviewed_time_s: 1.04,
          included: true,
          source: "imu_peak",
        },
      ],
      content_sync: {
        status: "passed",
        video_event_count: 3,
        imu_event_count: 3,
        matched_event_count: 3,
        message: "视频闪光与 IMU 冲击峰值按事件序号一一对应",
      },
      review_revision: 0,
      truth_comparison: "matched",
    },
  };
  const reviewedRun = {
    ...completedRun,
    alignment_result: {
      ...completedRun.alignment_result,
      review_revision: 1,
      parameters: { camera_1: 0, camera_4: -0.113 },
    },
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([task])))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(queuedRun), { status: 201 }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(completedRun)))
    .mockResolvedValueOnce(new Response(JSON.stringify(reviewedRun)));
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "执行任务" }));
  expect(
    await screen.findByText("画面内容同步（独立评价）"),
  ).toBeInTheDocument();
  expect(screen.getByText(/按事件序号一一对应/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "应用锚点复核" }));

  expect(await screen.findByText("锚点复核版本：1")).toBeInTheDocument();
  expect(await screen.findByText("应用锚点复核")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/runs/9/alignment-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: expect.any(String),
  });
});
