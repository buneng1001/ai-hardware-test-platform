import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, test, expect } from "vitest";
import { V030ReportProgress } from "./V030ReportProgress";
afterEach(cleanup);
const progress = {
  invocation_id: "run",
  status: "running",
  started_at: "2026-11-25T00:00:00Z",
  phase: "model_request",
  completed_batches: 3,
  total_batches: 6,
  saved_units: 3,
};
test("real completed batch count is shown independently of elapsed seconds", () => {
  const view = render(<V030ReportProgress progress={progress} />);
  expect(screen.getByText("已完成批次 3 / 6")).toBeVisible();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "3");
  view.rerender(
    <V030ReportProgress progress={{ ...progress, phase: "repair" }} />,
  );
  expect(screen.getByText("修复模型输出结构")).toBeVisible();
  view.rerender(
    <V030ReportProgress
      progress={{
        ...progress,
        status: "interrupted",
        completed_batches: null,
        total_batches: null,
      }}
    />,
  );
  expect(screen.getByText("运行意外中断")).toBeVisible();
  expect(screen.getByText("已保存检查点 3 个")).toBeVisible();
  expect(screen.queryByRole("progressbar")).toBeNull();
});
