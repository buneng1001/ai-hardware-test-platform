import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { FrontendRoot } from "../FrontendRoot";
import type {
  DataPackage,
  DataPackageDeletionImpact,
} from "../dataPackagesApi";
import { projectSummary, productVersion } from "./casesFixtures";
import { jsonResponse } from "./testHttp";

export function dataPackage(overrides: Partial<DataPackage>): DataPackage {
  return {
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
    ...overrides,
  };
}

export function dataPackageFiles(): DataPackage["files"] {
  return [
    {
      kind: "video",
      path: "runs/12/camera_1.mp4",
      size_bytes: 1024,
      sha256: "video-sha-123456",
      codec: "h264",
      start_raw_device_timestamp_ns: 1700000000000000000,
    },
    {
      kind: "imu",
      path: "runs/12/imu.csv",
      size_bytes: 512,
      sha256: "imu-sha-654321",
      codec: null,
      start_raw_device_timestamp_ns: null,
    },
  ];
}

export type DataStubState = {
  items: DataPackage[];
  detail?: DataPackage;
  impact?: DataPackageDeletionImpact;
  registerItems?: DataPackage[];
  failListTimes?: number;
};

/** 模拟项目、趋势和数据包接口，测试不访问真实后端。 */
export function stubDataApi(state: DataStubState) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/projects?"))
        return jsonResponse([projectSummary]);
      if (url === "/api/projects/1")
        return jsonResponse({
          ...projectSummary,
          product_versions: [productVersion],
        });
      if (url === "/api/projects/1/trends")
        return jsonResponse({
          project_id: 1,
          status: "empty",
          message: "尚无最终报告",
          points: [],
        });
      if (url.startsWith("/api/data-packages")) {
        return handleDataPackagesRequest(url, method, state);
      }
      return jsonResponse({ detail: "未模拟的接口" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function handleDataPackagesRequest(
  url: string,
  method: string,
  state: DataStubState,
) {
  if (
    method === "POST" &&
    url === "/api/data-packages/register-completed-runs"
  ) {
    state.items = state.registerItems ?? state.items;
    return jsonResponse({ items: state.items });
  }
  if (url === "/api/data-packages" || url.startsWith("/api/data-packages?")) {
    if ((state.failListTimes ?? 0) > 0) {
      state.failListTimes = (state.failListTimes ?? 0) - 1;
      return jsonResponse({ detail: "数据包服务暂时不可用" }, 500);
    }
    const query = new URL(url, "http://local").searchParams;
    const items = state.items.filter((item) => {
      const sourceType = query.get("source_type");
      const dataKind = query.get("data_kind");
      const faultType = query.get("fault_type");
      return (
        (!sourceType || item.source_type === sourceType) &&
        (!dataKind || item.data_kind === dataKind) &&
        (!faultType || item.fault_type === faultType)
      );
    });
    return jsonResponse({ items });
  }
  const detailMatch = url.match(/^\/api\/data-packages\/(\d+)$/);
  if (detailMatch && method === "GET") {
    return jsonResponse(
      state.detail ?? {
        ...(state.items.find((item) => item.id === Number(detailMatch[1])) ??
          dataPackage({})),
        files: dataPackageFiles(),
      },
    );
  }
  const impactMatch = url.match(
    /^\/api\/data-packages\/(\d+)\/deletion-impact$/,
  );
  if (impactMatch && method === "GET")
    return state.impact
      ? jsonResponse(state.impact)
      : jsonResponse({ detail: "删除影响未模拟" }, 404);
  const deleteMatch = url.match(/^\/api\/data-packages\/(\d+)\?confirm=true$/);
  if (deleteMatch && method === "DELETE") {
    state.items = state.items.filter(
      (item) => item.id !== Number(deleteMatch[1]),
    );
    return new Response(null, { status: 204 });
  }
  return jsonResponse({ detail: "未模拟的接口" }, 404);
}

/** 进入冻结版工作区的“测试数据”页签。 */
export async function openDataView() {
  render(<FrontendRoot />);
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));
  fireEvent.click(await screen.findByRole("button", { name: "测试数据" }));
  await screen.findByRole("button", { name: "登记已完成数据任务结果" });
}

export function callsOf(
  fetchMock: ReturnType<typeof vi.fn>,
): Array<[RequestInfo | URL, RequestInit | undefined]> {
  return fetchMock.mock.calls as unknown as Array<
    [RequestInfo | URL, RequestInit | undefined]
  >;
}
