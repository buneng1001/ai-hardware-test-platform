import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FrontendRoot } from "./FrontendRoot";
import type {
  ProjectDetail,
  ProjectTrend,
  ReportComparison,
} from "./projectsApi";
import {
  mockProjectApi,
  v020Detail,
  v020Project,
  v020Version,
} from "./v020ProjectFixtures";

const counts = {
  automation: { passed: 1, failed: 1, blocked: 0, not_executed: 0 },
  manual: { passed: 0, failed: 0, blocked: 0, not_executed: 1 },
};

const secondVersion = {
  ...v020Version,
  id: 12,
  version: "EVT2",
  name: "结构验证",
};

const detail: ProjectDetail = {
  ...v020Detail,
  product_versions: [v020Version, secondVersion],
};

const readyTrend: ProjectTrend = {
  project_id: 1,
  status: "ready",
  message: "共 2 份最终报告",
  points: [
    {
      report_id: 5,
      product_version_id: 11,
      product_version: "EVT1",
      test_group_id: 21,
      test_group: "基础回归",
      created_at: "2026-10-30T10:00:00+00:00",
      lifecycle_status: "current",
      counts,
      modules: [{ name: "采集", conclusion: "建议暂缓并补充验证", counts }],
    },
    {
      report_id: 4,
      product_version_id: 12,
      product_version: "EVT2",
      test_group_id: 22,
      test_group: "故障专项",
      created_at: "2026-10-29T10:00:00+00:00",
      lifecycle_status: "stale",
      counts,
      modules: [{ name: "电源", conclusion: "建议进入下一阶段", counts }],
    },
  ],
};

const comparison: ReportComparison = {
  project_id: 1,
  left: {
    kind: "report",
    id: 5,
    label: "报告 #5",
    report_ids: [5],
  },
  right: {
    kind: "report",
    id: 4,
    label: "报告 #4",
    report_ids: [4],
  },
  counts: { left: counts, right: counts },
  modules: [
    {
      name: "采集",
      left: counts,
      right: counts,
      left_conclusion: "建议暂缓并补充验证",
      right_conclusion: "建议进入下一阶段",
    },
  ],
  added_modules: ["电源"],
  removed_modules: [],
  added_scope: [
    {
      case_number: "SRC-002",
      title: "充电检查",
      module: "电源",
      sources: ["manual"],
    },
  ],
  removed_scope: [],
  unaligned_scope: [
    { case_number: "SRC-003", left_modules: ["采集"], right_modules: ["结构"] },
  ],
  unresolved_risk_modules: ["采集"],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function projectRoutes(
  trend:
    ProjectTrend | ((init?: RequestInit, url?: string) => unknown) = readyTrend,
  extra: Record<string, unknown> = {},
) {
  return {
    "GET /api/projects": [v020Project],
    "GET /api/projects/1": detail,
    "GET /api/projects/1/trends": trend,
    ...extra,
  };
}

async function openWorkspace() {
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));
  await screen.findByRole("heading", { name: "EVT1 测试工作区" });
}

test("版本与趋势展示最终报告数据点、过期标记和模块结果", async () => {
  vi.stubGlobal("fetch", mockProjectApi(projectRoutes()));
  render(<FrontendRoot />);
  await openWorkspace();

  expect(await screen.findByText("报告 #5 · EVT1 · 基础回归")).toBeVisible();
  expect(screen.getByText("报告 #4 · EVT2 · 故障专项")).toBeVisible();
  expect(screen.getByText("报告已过期")).toBeVisible();
  expect(
    screen.getAllByText(/自动化：通过 1 · 失败 1 · 阻塞 0 · 未执行 0/).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText(/人工：通过 0 · 失败 0 · 阻塞 0 · 未执行 1/).length,
  ).toBeGreaterThan(0);
  expect(screen.getByText("采集", { selector: "strong" })).toBeVisible();
  expect(screen.getAllByText(/建议暂缓并补充验证/).length).toBeGreaterThan(0);
});

test("趋势支持按版本、模块、测试组和用例筛选，并可清除筛选", async () => {
  const requestedUrls: string[] = [];
  const trendRoute = (_init?: RequestInit, url?: string) => {
    requestedUrls.push(url ?? "");
    const query = new URL(url ?? "", "http://local").searchParams;
    if (query.size > 0) {
      return {
        ...readyTrend,
        status: "filtered_empty",
        message: "当前筛选没有匹配的最终报告",
        points: [],
      };
    }
    return readyTrend;
  };
  vi.stubGlobal("fetch", mockProjectApi(projectRoutes(trendRoute)));
  render(<FrontendRoot />);
  await openWorkspace();
  await screen.findByText("报告 #5 · EVT1 · 基础回归");

  fireEvent.change(screen.getByLabelText("筛选产品版本"), {
    target: { value: "11" },
  });
  fireEvent.change(screen.getByLabelText("筛选模块"), {
    target: { value: "采集" },
  });
  fireEvent.change(screen.getByLabelText("筛选测试组"), {
    target: { value: "21" },
  });
  fireEvent.change(screen.getByLabelText("筛选用例编号"), {
    target: { value: "SRC-001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "筛选趋势" }));

  await waitFor(() =>
    expect(screen.getByText(/当前筛选没有匹配的最终报告/)).toBeVisible(),
  );
  const requested = new URL(requestedUrls.at(-1) ?? "", "http://local");
  expect(requested.searchParams.get("product_version_id")).toBe("11");
  expect(requested.searchParams.get("module")).toBe("采集");
  expect(requested.searchParams.get("test_group_id")).toBe("21");
  expect(requested.searchParams.get("case_number")).toBe("SRC-001");

  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(await screen.findByText("报告 #5 · EVT1 · 基础回归")).toBeVisible();
});

test("只有一个数据点时保留数据点并提示暂不展示变化", async () => {
  const singleTrend: ProjectTrend = {
    ...readyTrend,
    status: "single",
    message: "只有一个数据点",
    points: [readyTrend.points[0]],
  };
  vi.stubGlobal("fetch", mockProjectApi(projectRoutes(singleTrend)));
  render(<FrontendRoot />);
  await openWorkspace();

  expect(
    await screen.findByText("只有一个数据点，暂不展示变化趋势。"),
  ).toBeVisible();
  expect(screen.getByText("报告 #5 · EVT1 · 基础回归")).toBeVisible();
});

test("比较必须主动选择两个对象，并明确展示范围变化", async () => {
  let posted: unknown = null;
  vi.stubGlobal(
    "fetch",
    mockProjectApi(
      projectRoutes(readyTrend, {
        "POST /api/projects/1/report-comparisons": (init?: RequestInit) => {
          posted = JSON.parse(String(init?.body));
          return comparison;
        },
      }),
    ),
  );
  render(<FrontendRoot />);
  await openWorkspace();
  await screen.findByText("报告 #5 · EVT1 · 基础回归");

  const left = screen.getByLabelText("左侧比较对象");
  const right = screen.getByLabelText("右侧比较对象");
  expect(left).toHaveValue("");
  expect(right).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "比较" }));
  expect(await screen.findByText("请主动选择两个比较对象")).toBeVisible();
  expect(posted).toBeNull();

  fireEvent.change(screen.getByLabelText("比较对象类型"), {
    target: { value: "report" },
  });
  fireEvent.change(screen.getByLabelText("左侧比较对象"), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByLabelText("右侧比较对象"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "比较" }));

  expect(
    await screen.findByRole("region", { name: "版本或报告比较结果" }),
  ).toBeVisible();
  expect(posted).toEqual({
    left_report_id: 5,
    right_report_id: 4,
  });
  expect(screen.getByText(/新增模块：电源/)).toBeVisible();
  expect(screen.getByText(/SRC-003：左侧 采集；右侧 结构/)).toBeVisible();
  expect(
    screen.getByText(/范围缺失或无法对齐只表示测试范围变化/),
  ).toBeVisible();
});
