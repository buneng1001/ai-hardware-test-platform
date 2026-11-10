import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { V020ReportTrendChart } from "./V020ReportTrendChart";
import {
  getDisplayedResultTotals,
  V020ResultBreakdown,
} from "./V020ResultBreakdown";
import type { ProjectTrendPoint } from "./projectsApi";

afterEach(cleanup);

const counts = {
  passed: 2,
  failed: 1,
  blocked: 1,
  not_executed: 6,
};

function trendPoint(
  id: number,
  status: ProjectTrendPoint["lifecycle_status"],
): ProjectTrendPoint {
  return {
    report_id: id,
    product_version_id: id,
    product_version: `EVT${id}`,
    test_group_id: id,
    test_group: "回归测试",
    created_at: `2026-10-${id + 10}T11:00:00+00:00`,
    lifecycle_status: status,
    counts: {
      automation: counts,
      manual: { passed: 0, failed: 0, blocked: 0, not_executed: 0 },
    },
    modules: [],
  };
}

test("结果分布只使用四类真实计数，通过率分母不包含未执行", () => {
  expect(getDisplayedResultTotals(counts)).toEqual({
    tested: 4,
    total: 10,
    rate: 50,
  });
  render(
    <V020ResultBreakdown counts={counts} label="事实报告" variant="ring" />,
  );
  expect(screen.getByText("50.0%")).toBeVisible();
  expect(
    screen.getByRole("figure", {
      name: "事实报告：通过 2，失败 1，阻塞 1，未执行 6",
    }),
  ).toBeVisible();
  expect(screen.getByText(/未执行不计入分母/)).toBeVisible();
});

test("无已执行结果不伪造百分比，完全空记录不画图", () => {
  expect(
    getDisplayedResultTotals({
      passed: 0,
      failed: 0,
      blocked: 0,
      not_executed: 2,
    }).rate,
  ).toBeNull();
  const { rerender } = render(
    <V020ResultBreakdown
      counts={{ passed: 0, failed: 0, blocked: 0, not_executed: 2 }}
      label="人工批次"
      variant="ring"
    />,
  );
  expect(screen.getByText("—")).toBeVisible();
  expect(screen.getByText(/暂无已执行结果/)).toBeVisible();
  rerender(
    <V020ResultBreakdown
      counts={{ passed: 0, failed: 0, blocked: 0, not_executed: 0 }}
      label="人工批次"
    />,
  );
  expect(screen.getByText("暂无可绘制的人工批次结果数据")).toBeVisible();
  expect(screen.queryByRole("figure")).toBeNull();
});

test("最终报告趋势至少需要两份真实报告并标记过期状态", () => {
  const points = [trendPoint(5, "current"), trendPoint(4, "stale")];
  const { rerender } = render(<V020ReportTrendChart points={points} />);
  expect(
    screen.getByRole("region", { name: "最终报告通过率趋势" }),
  ).toBeVisible();
  expect(screen.getAllByText("50.0%")).toHaveLength(2);
  expect(screen.getByText("已过期")).toBeVisible();
  expect(screen.getByText("报告 #4")).toBeVisible();
  rerender(<V020ReportTrendChart points={[points[0]]} />);
  expect(
    screen.queryByRole("region", { name: "最终报告通过率趋势" }),
  ).toBeNull();
});
