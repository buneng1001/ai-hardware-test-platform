import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { V020ReportAnalysisSection } from "./V020ReportAnalysisSection";
import { factReport } from "./test/reportFixtures";

afterEach(() => cleanup());

const input = {
  same_input: false,
  has_previous: false,
  running_same_operation: false,
  occupied_other: false,
  resume_available: true,
};

test("T08 有检查点时只在人工选择继续后启动新请求", async () => {
  const onRetry = vi.fn();
  render(
    <V020ReportAnalysisSection
      report={factReport({
        analysis: { status: "failed", output: null, message: "上一批失败" },
      })}
      busy={false}
      onRetry={onRetry}
      onRerun={vi.fn()}
      onCheckRepeat={async () => input}
      onCancel={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "重试报告分析" }));
  const dialog = await screen.findByRole("dialog", {
    name: "报告 AI 分批续做",
  });
  expect(onRetry).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(onRetry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重试报告分析" }));
  const retryDialog = await screen.findByRole("dialog", {
    name: "报告 AI 分批续做",
  });
  fireEvent.click(
    within(retryDialog).getByRole("button", { name: "继续进行" }),
  );
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(onRetry).toHaveBeenCalledWith("continue");
});

test("T08 无检查点时直接重试，不显示续做弹窗", async () => {
  const onRetry = vi.fn();
  render(
    <V020ReportAnalysisSection
      report={factReport({
        analysis: { status: "failed", output: null, message: "单次请求失败" },
      })}
      busy={false}
      onRetry={onRetry}
      onRerun={vi.fn()}
      onCheckRepeat={async () => ({ ...input, resume_available: false })}
      onCancel={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "重试报告分析" }));
  await screen.findByText("单次请求失败");
  expect(screen.queryByRole("dialog", { name: "报告 AI 分批续做" })).toBeNull();
});
