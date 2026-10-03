import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { DataPackagesPanel } from "./DataPackagesPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const packageSummary = {
  id: 7,
  package_number: "DP-000007",
  source_task_id: 3,
  source_task_name: "EVT1 录制采集",
  source_run_id: 12,
  source_run_execution_number: 2,
  source_type: "generated",
  data_kind: "fault",
  fault_type: "video_drop",
  version_fingerprint: "abc123def456789",
  generated_at: "2026-10-03T08:00:00Z",
  validation_status: "passed",
  validation_message: "数据包文件、视频和 IMU 通道已通过完整性校验",
  channels: ["camera_1", "camera_2"],
  timestamps: { first_raw_device_timestamp_ns: 1700000000000000000 },
  integrity: {
    status: "passed",
    checked_file_count: 3,
    missing_files: [],
    size_mismatches: [],
  },
  eligible_for_test_group: true,
  has_newer_source_result: true,
  recommended_source_run_id: 15,
  files: [],
};

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("测试工程师可筛选、查看并确认删除数据包影响范围", async () => {
  const detail = {
    ...packageSummary,
    files: [
      {
        kind: "video",
        path: "runs/12/camera_1.mp4",
        size_bytes: 1024,
        sha256: "video-sha",
        codec: "h264",
        start_raw_device_timestamp_ns: 1700000000000000000,
      },
      {
        kind: "imu",
        path: "runs/12/imu.csv",
        size_bytes: 512,
        sha256: "imu-sha",
        codec: null,
        start_raw_device_timestamp_ns: null,
      },
    ],
  };
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/data-packages")
        return Promise.resolve(response({ items: [packageSummary] }));
      if (url === "/api/data-packages?data_kind=fault")
        return Promise.resolve(response({ items: [packageSummary] }));
      if (url === "/api/data-packages/7")
        return Promise.resolve(response(detail));
      if (url === "/api/data-packages/7/deletion-impact") {
        return Promise.resolve(
          response({
            data_package_id: 7,
            package_number: "DP-000007",
            association_counts: {
              test_groups: 2,
              automation_test_cases: 3,
              automation_execution_records: 1,
            },
            total_associations: 6,
          }),
        );
      }
      if (
        url === "/api/data-packages/7?confirm=true" &&
        init?.method === "DELETE"
      ) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`未预期请求：${url}`));
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<DataPackagesPanel />);
  expect(await screen.findByText("DP-000007")).toBeInTheDocument();
  expect(
    screen.getByText("输入源已有更新：推荐运行 #15，不会自动替换当前包。"),
  ).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("数据属性"), {
    target: { value: "fault" },
  });
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/data-packages?data_kind=fault",
      undefined,
    ),
  );

  fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
  expect(
    await screen.findByLabelText("DP-000007 数据包详情"),
  ).toHaveTextContent("camera_1、camera_2");
  expect(screen.getByText(/runs\/12\/imu.csv/)).toBeInTheDocument();
  expect(screen.getByText(/时间戳 未提供/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "删除数据包" }));
  const dialog = await screen.findByRole("dialog", {
    name: "删除数据包影响范围",
  });
  expect(dialog).toHaveTextContent("测试组：2");
  expect(dialog).toHaveTextContent("自动化用例：3");
  fireEvent.click(screen.getByRole("button", { name: "确认删除数据包" }));
  await waitFor(() =>
    expect(screen.queryByText("DP-000007")).not.toBeInTheDocument(),
  );
  expect(fetchMock).toHaveBeenCalledWith("/api/data-packages/7?confirm=true", {
    method: "DELETE",
  });
});
