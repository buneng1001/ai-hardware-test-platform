import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FactReportPanel } from "./FactReportPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("测试工程师可以选择记录生成并下载事实报告", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === "/api/test-groups/4/automation-executions") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 9,
                execution_number: 2,
                summary: { passed: 1, failed: 0, blocked: 0, not_executed: 0 },
                case_results: [],
              },
            ],
          }),
        ),
      );
    }
    if (url === "/api/test-groups/4/manual-test-result-batches") {
      return Promise.resolve(
        new Response(
          JSON.stringify({ cases: [], batches: [{ id: 8, batch_number: 1 }] }),
        ),
      );
    }
    if (url === "/api/test-groups/4/fact-reports" && init?.method === "POST") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 12,
            test_group_id: 4,
            product_version_id: 2,
            automation_execution_id: 9,
            manual_batch_ids: [8],
            created_at: "2026-10-05T00:00:00Z",
            snapshot: {
              warnings: ["当前记录来自历史配置，报告将使用历史快照。"],
              stage_progress: { conclusion: "建议暂缓并补充验证", basis: [] },
              ai_analysis: { status: "not_configured", message: "AI 未配置" },
            },
            analysis: {
              status: "pending",
              message: "AI 分析正在运行",
              output: null,
            },
          }),
        ),
      );
    }
    if (url === "/api/fact-reports/12" && !init) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 12,
            test_group_id: 4,
            product_version_id: 2,
            automation_execution_id: 9,
            manual_batch_ids: [8],
            created_at: "2026-10-05T00:00:00Z",
            snapshot: {
              warnings: [],
              stage_progress: { conclusion: "建议暂缓并补充验证", basis: [] },
              ai_analysis: { status: "not_configured", message: "AI 未配置" },
            },
            analysis: {
              status: "failed",
              message: "分析未完成：模型网络请求失败",
              output: null,
            },
          }),
        ),
      );
    }
    if (url === "/api/fact-reports/12/analysis" && init?.method === "POST") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "completed",
            message: "AI 分析已完成",
            output: {
              risks: [],
              additional_verifications: [],
              regression_recommendations: [],
              stage_recommendation: {
                suggestion: "建议暂缓并补充验证",
                content: "依据已保存报告",
                evidence_refs: ["stage_progress"],
              },
            },
          }),
        ),
      );
    }
    throw new Error(`未预期请求：${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<FactReportPanel groupId={4} />);
  fireEvent.change(await screen.findByLabelText("自动化执行记录（最多一条）"), {
    target: { value: "9" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "批次 #1" }));
  fireEvent.click(screen.getByRole("button", { name: "生成事实报告" }));

  expect(await screen.findByTitle("事实报告预览")).toHaveAttribute(
    "src",
    "/api/fact-reports/12.html",
  );
  expect(screen.getByRole("link", { name: "下载 HTML 报告" })).toHaveAttribute(
    "href",
    "/api/fact-reports/12.html",
  );
  expect(
    screen.getByText("阶段推进结论：建议暂缓并补充验证"),
  ).toBeInTheDocument();
  expect(
    await screen.findByText("AI 分析：分析未完成：模型网络请求失败"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试报告分析" }));
  expect(await screen.findByText("AI 分析：AI 分析已完成")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/fact-reports/12/analysis", {
    method: "POST",
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/test-groups/4/fact-reports",
    expect.objectContaining({
      body: JSON.stringify({
        automation_execution_id: 9,
        manual_batch_ids: [8],
      }),
    }),
  );
});
