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

function openNewTaskPage() {
  fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
}

test("页面提供可编辑的任务名称建议", async () => {
  const fetchMock = successfulPageLoad();
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  openNewTaskPage();

  const nameInput = await screen.findByLabelText("任务名称");
  expect(nameInput).toHaveAttribute("placeholder", "例如：快速-正常采集");
  fireEvent.click(screen.getByRole("button", { name: "使用建议名称" }));
  expect(nameInput).toHaveValue("快速-正常采集");
});

test("新建任务不展示判定模式且不提交正式规格依据", async () => {
  const fetchMock = successfulPageLoad().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        id: 20,
        name: "无验收依据任务",
        mode: "quick",
        scenario: "normal",
        reference_channel: "camera_1",
        evaluation: null,
        status: "draft",
        duration_seconds: 2,
        video: {
          channels: 2,
          resolution: "640x360",
          fps: 30,
          container: "mp4",
          codec: "h264",
        },
        imu: { format: "csv", sample_rate_hz: 100 },
        random_seed: 20260822,
        created_at: "2026-08-30T12:00:00Z",
      }),
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  const nameInput = await screen.findByLabelText("任务名称");
  fireEvent.change(nameInput, { target: { value: "无验收依据任务" } });
  expect(screen.queryByLabelText("判定模式")).not.toBeInTheDocument();
  expect(screen.queryByText(/正式规格/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(await screen.findByText("快速 · 正常采集 · 草稿")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      body: expect.not.stringContaining("evaluation"),
    }),
  );
});

test("测试工程师能从页面提交完整的自定义多通道配置", async () => {
  const fetchMock = successfulPageLoad().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        id: 12,
        name: "双路 JSONL",
        mode: "custom",
        scenario: "normal",
        reference_channel: "camera_1",
        status: "draft",
        duration_seconds: 2,
        video: {
          channels: 2,
          resolution: "640x360",
          fps: 30,
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
  openNewTaskPage();
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "双路 JSONL" },
  });
  fireEvent.change(screen.getByLabelText("数据模式"), {
    target: { value: "custom" },
  });
  expect(screen.getByLabelText("视频码率（kbps）")).toHaveAttribute(
    "min",
    "100",
  );
  expect(screen.getByLabelText("视频码率（kbps）")).toHaveAttribute(
    "max",
    "50000",
  );
  expect(screen.getByLabelText("码率模式")).toHaveTextContent("cbrvbr");
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
        reference_channel: "camera_1",
        duration_seconds: 2,
        video: {
          channels: 2,
          resolution: "640x360",
          fps: 30,
          container: "mkv",
          bitrate_kbps: 3500,
          bitrate_mode: "cbr",
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
  openNewTaskPage();
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
  openNewTaskPage();
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
  expect(screen.getByLabelText("帧率")).toHaveTextContent("24253060120");
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
        reference_channel: "camera_1",
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
  openNewTaskPage();
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
        reference_channel: "camera_1",
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
        reference_channel: "camera_1",
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
  openNewTaskPage();
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
        reference_channel: "camera_1",
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
  openNewTaskPage();
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
        reference_channel: "camera_1",
      }),
    }),
  );
});

test.skip("旧版：测试工程师能选择工程目标模式并提交阈值来源", async () => {
  const fetchMock = successfulPageLoad().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        id: 13,
        name: "工程目标判定",
        mode: "quick",
        scenario: "normal",
        reference_channel: "camera_1",
        evaluation: {
          mode: "engineering_target",
          threshold_source: "engineering_target",
          thresholds: { max_failed_checks: 2 },
        },
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
  openNewTaskPage();
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "工程目标判定" },
  });
  fireEvent.change(screen.getByLabelText("判定模式"), {
    target: { value: "engineering_target" },
  });
  fireEvent.change(screen.getByLabelText("允许失败检查数"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(await screen.findByText("快速 · 正常采集 · 草稿")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      body: expect.stringContaining('"threshold_source":"engineering_target"'),
    }),
  );
});

test.skip("旧版：测试工程师能选择摸底分析并不提交合格性阈值", async () => {
  const fetchMock = successfulPageLoad().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        id: 14,
        name: "版本基线摸底",
        mode: "quick",
        scenario: "normal",
        reference_channel: "camera_1",
        evaluation: {
          mode: "baseline_analysis",
          threshold_source: "version_baseline",
          thresholds: {},
          priority: [
            "formal_specification",
            "engineering_target",
            "version_baseline",
          ],
        },
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
  openNewTaskPage();
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "版本基线摸底" },
  });
  fireEvent.change(screen.getByLabelText("判定模式"), {
    target: { value: "baseline_analysis" },
  });
  expect(screen.queryByLabelText("允许失败检查数")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(await screen.findByText("快速 · 正常采集 · 草稿")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      body: expect.stringContaining('"thresholds":{}'),
    }),
  );
});

test.skip("旧版：测试工程师能显式提交需求验收模式", async () => {
  const fetchMock = successfulPageLoad().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        id: 15,
        name: "正式规格验收",
        mode: "quick",
        scenario: "normal",
        reference_channel: "camera_1",
        evaluation: {
          mode: "requirements_acceptance",
          threshold_source: "formal_specification",
          thresholds: { max_failed_checks: 1 },
          priority: [
            "formal_specification",
            "engineering_target",
            "version_baseline",
          ],
        },
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
  openNewTaskPage();
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "正式规格验收" },
  });
  fireEvent.change(screen.getByLabelText("允许失败检查数"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(await screen.findByText("快速 · 正常采集 · 草稿")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      body: expect.stringContaining(
        '"threshold_source":"formal_specification"',
      ),
    }),
  );
});
