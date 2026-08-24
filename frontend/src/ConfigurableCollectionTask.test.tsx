import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function successfulPageLoad() {
  return vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])));
}

test("测试工程师能从页面提交完整的自定义多通道配置", async () => {
  const fetchMock = successfulPageLoad().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        id: 12,
        name: "双路 JSONL",
        mode: "custom",
        scenario: "normal",
        status: "draft",
        duration_seconds: 2,
        video: {
          channels: 2,
          resolution: "640x360",
          fps: 15,
          container: "mkv",
          codec: "h264",
        },
        imu: { format: "jsonl", sample_rate_hz: 100 },
        random_seed: 42,
        created_at: "2026-08-22T12:00:00Z",
      }),
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "双路 JSONL" },
  });
  fireEvent.change(screen.getByLabelText("数据模式"), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByLabelText("视频通道数"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("视频容器"), {
    target: { value: "mkv" },
  });
  fireEvent.change(screen.getByLabelText("IMU 格式"), {
    target: { value: "jsonl" },
  });
  fireEvent.change(screen.getByLabelText("IMU 采样率"), {
    target: { value: "100" },
  });
  fireEvent.change(screen.getByLabelText("随机种子"), {
    target: { value: "42" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(
    await screen.findByText("自定义 · 正常采集 · 草稿"),
  ).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "双路 JSONL",
        mode: "custom",
        scenario: "normal",
        duration_seconds: 2,
        video: {
          channels: 2,
          resolution: "640x360",
          fps: 15,
          container: "mkv",
        },
        imu: { format: "jsonl", sample_rate_hz: 100 },
        random_seed: 42,
      }),
    }),
  );
});

test("页面在调用 API 前拒绝预计文件规模过大的配置", async () => {
  const fetchMock = successfulPageLoad();
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "超大配置" },
  });
  fireEvent.change(screen.getByLabelText("数据模式"), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByLabelText("视频通道数"), {
    target: { value: "4" },
  });
  fireEvent.change(screen.getByLabelText("分辨率"), {
    target: { value: "1920x1080" },
  });
  fireEvent.change(screen.getByLabelText("帧率"), { target: { value: "60" } });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "预计文件规模超过安全上限",
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("页面公开规格规定的选项和数值边界并拒绝越界时长", async () => {
  const fetchMock = successfulPageLoad();
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.change(await screen.findByLabelText("数据模式"), {
    target: { value: "custom" },
  });

  expect(screen.getByLabelText("时长（秒）")).toHaveAttribute("min", "2");
  expect(screen.getByLabelText("时长（秒）")).toHaveAttribute("max", "300");
  expect(screen.getByLabelText("视频通道数")).toHaveAttribute("min", "1");
  expect(screen.getByLabelText("视频通道数")).toHaveAttribute("max", "4");
  expect(screen.getByLabelText("分辨率")).toHaveTextContent(
    "640x3601280x7201920x1080",
  );
  expect(screen.getByLabelText("帧率")).toHaveTextContent("1524253060");
  expect(screen.getByLabelText("IMU 采样率")).toHaveTextContent("50100200500");

  fireEvent.change(screen.getByLabelText("任务名称"), {
    target: { value: "越界时长" },
  });
  fireEvent.change(screen.getByLabelText("时长（秒）"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(screen.getByLabelText("时长（秒）")).not.toBeValid();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("测试工程师能从页面创建单路视频掉帧场景", async () => {
  const fetchMock = successfulPageLoad().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        id: 13,
        name: "固定种子掉帧",
        mode: "quick",
        scenario: "video_drop",
        status: "draft",
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
        created_at: "2026-08-22T12:00:00Z",
      }),
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "固定种子掉帧" },
  });
  fireEvent.change(screen.getByLabelText("场景"), {
    target: { value: "video_drop" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(
    await screen.findByText("快速 · 单路视频掉帧 · 草稿"),
  ).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "固定种子掉帧",
        mode: "quick",
        scenario: "video_drop",
      }),
    }),
  );
});

test("测试工程师能从页面创建固定种子的 IMU 异常场景", async () => {
  const fetchMock = successfulPageLoad().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        id: 14,
        name: "固定种子 IMU 异常",
        mode: "quick",
        scenario: "imu_anomaly",
        status: "draft",
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
        created_at: "2026-08-23T12:00:00Z",
      }),
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "固定种子 IMU 异常" },
  });
  fireEvent.change(screen.getByLabelText("场景"), {
    target: { value: "imu_anomaly" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(await screen.findByText("快速 · IMU 异常 · 草稿")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "固定种子 IMU 异常",
        mode: "quick",
        scenario: "imu_anomaly",
      }),
    }),
  );
});

test("测试工程师能从页面创建存储不足场景", async () => {
  const fetchMock = successfulPageLoad().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        id: 15,
        name: "固定种子存储不足",
        mode: "quick",
        scenario: "storage_exhaustion",
        status: "draft",
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
        created_at: "2026-08-24T12:00:00Z",
      }),
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "固定种子存储不足" },
  });
  fireEvent.change(screen.getByLabelText("场景"), {
    target: { value: "storage_exhaustion" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(await screen.findByText("快速 · 存储不足 · 草稿")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "固定种子存储不足",
        mode: "quick",
        scenario: "storage_exhaustion",
      }),
    }),
  );
});
