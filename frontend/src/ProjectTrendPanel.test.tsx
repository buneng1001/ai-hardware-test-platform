import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ProjectTrendPanel } from "./ProjectTrendPanel";
import type { ProjectDetail, ProjectTrend } from "./projectsApi";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const project: ProjectDetail = {
  id: 1,
  name: "IRIS",
  product_name: "Recorder",
  description: "",
  product_version_count: 2,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  product_versions: [
    {
      id: 11,
      project_id: 1,
      version: "EVT1",
      name: "",
      description: "",
      created_at: "",
      updated_at: "",
    },
    {
      id: 12,
      project_id: 1,
      version: "EVT2",
      name: "",
      description: "",
      created_at: "",
      updated_at: "",
    },
  ],
};

const counts = {
  automation: { passed: 1, failed: 0, blocked: 0, not_executed: 0 },
  manual: { passed: 0, failed: 0, blocked: 0, not_executed: 0 },
};

const trend: ProjectTrend = {
  project_id: 1,
  status: "ready",
  message: "已按最终报告汇总趋势",
  points: [
    {
      report_id: 20,
      product_version_id: 11,
      product_version: "EVT1",
      test_group_id: 30,
      test_group: "回归",
      created_at: "2026-10-01T00:00:00Z",
      lifecycle_status: "stale",
      counts,
      modules: [{ name: "采集", conclusion: "建议进入下一阶段", counts }],
    },
    {
      report_id: 21,
      product_version_id: 12,
      product_version: "EVT2",
      test_group_id: 31,
      test_group: "回归",
      created_at: "2026-10-02T00:00:00Z",
      lifecycle_status: "current",
      counts,
      modules: [{ name: "采集", conclusion: "建议进入下一阶段", counts }],
    },
  ],
};

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

test("趋势支持筛选，并且比较必须由工程师显式选择对象", async () => {
  const comparison = {
    project_id: 1,
    left: {
      kind: "product_version",
      id: 11,
      label: "产品版本 EVT1",
      report_ids: [20],
    },
    right: {
      kind: "product_version",
      id: 12,
      label: "产品版本 EVT2",
      report_ids: [21],
    },
    counts: { left: counts, right: counts },
    modules: [],
    added_modules: ["存储"],
    removed_modules: [],
    added_scope: [
      {
        case_number: "SRC-002",
        title: "存储",
        module: "存储",
        sources: ["manual"],
      },
    ],
    removed_scope: [],
    unaligned_scope: [],
    unresolved_risk_modules: [],
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        ...trend,
        status: "single",
        message: "当前筛选条件只有一个报告数据点",
        points: [trend.points[0]],
      }),
    )
    .mockResolvedValueOnce(jsonResponse(comparison));
  vi.stubGlobal("fetch", fetchMock);

  render(<ProjectTrendPanel project={project} trend={trend} />);

  expect(screen.getByText(/报告已过期/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "比较" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请主动选择两个比较对象");
  expect(fetchMock).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("产品版本"), {
    target: { value: "11" },
  });
  fireEvent.change(screen.getByLabelText("模块"), {
    target: { value: "采集" },
  });
  fireEvent.change(screen.getByLabelText("测试组"), {
    target: { value: "30" },
  });
  fireEvent.change(screen.getByLabelText("测试用例编号"), {
    target: { value: "SRC-001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "筛选趋势" }));
  expect(
    await screen.findByText("当前筛选条件只有一个报告数据点"),
  ).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/projects/1/trends?product_version_id=11&module=%E9%87%87%E9%9B%86&test_group_id=30&case_number=SRC-001",
  );

  fireEvent.change(screen.getByLabelText("左侧比较对象"), {
    target: { value: "11" },
  });
  fireEvent.change(screen.getByLabelText("右侧比较对象"), {
    target: { value: "12" },
  });
  fireEvent.click(screen.getByRole("button", { name: "比较" }));
  expect(
    await screen.findByRole("region", { name: "版本或报告比较结果" }),
  ).toHaveTextContent("新增模块：存储");
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/projects/1/report-comparisons",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        left_product_version_id: 11,
        right_product_version_id: 12,
      }),
    },
  );
});
