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

test("测试工程师能创建固定偏移场景并切换参考时钟", async () => {
  const fetchMock = successfulPageLoad().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        id: 16,
        name: "固定偏移 camera_3 参考",
        mode: "quick",
        scenario: "fixed_offset",
        status: "draft",
        duration_seconds: 2,
        video: {
          channels: 3,
          resolution: "640x360",
          fps: 15,
          container: "mp4",
          codec: "h264",
        },
        imu: { format: "csv", sample_rate_hz: 50 },
        random_seed: 20260822,
        reference_channel: "camera_3",
        created_at: "2026-08-24T12:00:00Z",
      }),
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "固定偏移 camera_3 参考" },
  });
  fireEvent.change(screen.getByLabelText("场景"), {
    target: { value: "fixed_offset" },
  });
  fireEvent.change(screen.getByLabelText("参考时钟"), {
    target: { value: "camera_3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));

  expect(await screen.findByText("快速 · 固定偏移 · 草稿")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "固定偏移 camera_3 参考",
        mode: "quick",
        scenario: "fixed_offset",
        reference_channel: "camera_3",
      }),
    }),
  );
});
