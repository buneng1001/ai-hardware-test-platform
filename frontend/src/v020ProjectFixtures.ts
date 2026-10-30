import { vi } from "vitest";

import type {
  ProductVersion,
  ProjectDeletionImpact,
  ProjectDetail,
  ProjectSummary,
  ProjectTrend,
  VersionDeletionImpact,
} from "./projectsApi";

export const v020Project: ProjectSummary = {
  id: 1,
  name: "IRIS 头环",
  product_name: "多传感器记录设备",
  description: "Beta 测试项目",
  product_version_count: 1,
  created_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-02T08:00:00Z",
};

export const v020Version: ProductVersion = {
  id: 11,
  project_id: 1,
  version: "EVT1",
  name: "",
  description: "",
  created_at: "2026-10-01T08:10:00Z",
  updated_at: "2026-10-01T08:10:00Z",
};

export const v020Detail: ProjectDetail = {
  ...v020Project,
  product_versions: [v020Version],
};

export const v020EmptyTrend: ProjectTrend = {
  project_id: 1,
  status: "empty",
  message: "尚无最终报告",
  points: [],
};

const emptyCounts = {
  source_test_cases: 0,
  automation_test_cases: 0,
  data_packages: 0,
  test_groups: 0,
  automation_execution_records: 0,
  manual_test_result_batches: 0,
  manual_test_results: 0,
  manual_test_result_attachments: 0,
  online_reports: 0,
};

export const v020ProjectImpact: ProjectDeletionImpact = {
  project_id: 1,
  product_versions: [{ id: 11, version: "EVT1", name: "" }],
  asset_counts: {
    ...emptyCounts,
    source_test_cases: 3,
    automation_test_cases: 2,
    test_groups: 1,
    online_reports: 1,
  },
  total_affected_assets: 7,
};

export const v020VersionImpact: VersionDeletionImpact = {
  product_version: { id: 11, version: "EVT1", name: "" },
  asset_counts: { ...emptyCounts, automation_test_cases: 4, data_packages: 1 },
  total_affected_assets: 5,
};

type ProjectRoute = unknown | ((init?: RequestInit, url?: string) => unknown);

export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 按“方法 + 路径”路由的项目接口桩，未声明的方法返回 404。 */
export function mockProjectApi(routes: Record<string, ProjectRoute>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.split("?")[0]}`;
    if (!(key in routes)) return jsonResponse({ detail: `未模拟 ${key}` }, 404);
    const route = routes[key];
    const value =
      typeof route === "function"
        ? (route as (init?: RequestInit, url?: string) => unknown)(init, url)
        : route;
    if (value instanceof Response) return value;
    return jsonResponse(value);
  });
}
