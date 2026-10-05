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
    if (url === "/api/test-groups/4/report-history") {
      return Promise.resolve(new Response(JSON.stringify({ items: [] })));
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
            lifecycle_status: "current",
            attachment_summary: {
              attachment_count: 0,
              total_size_bytes: 0,
              attachments: [],
            },
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
            lifecycle_status: "current",
            attachment_summary: {
              attachment_count: 0,
              total_size_bytes: 0,
              attachments: [],
            },
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

test("测试工程师可以确认清理当前报告附件、查找历史并删除在线报告", async () => {
  let cleaned = false;
  const report = () => ({
    id: 7,
    test_group_id: 4,
    product_version_id: 2,
    automation_execution_id: 9,
    manual_batch_ids: [8],
    created_at: "2026-10-05T00:00:00Z",
    lifecycle_status: "current",
    attachment_summary: {
      attachment_count: 1,
      total_size_bytes: 8,
      attachments: [
        {
          id: 11,
          filename: "evidence.txt",
          content_type: "text/plain",
          size_bytes: 8,
          usage_status: "used",
          storage_status: cleaned ? "cleaned" : "stored",
        },
      ],
    },
    snapshot: {
      warnings: [],
      stage_progress: { conclusion: "建议进入下一阶段", basis: [] },
      ai_analysis: { status: "not_configured", message: "AI 未配置" },
    },
    analysis: { status: "not_enabled", message: "AI 未启用", output: null },
  });
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === "/api/test-groups/4/automation-executions") {
      return Promise.resolve(new Response(JSON.stringify({ items: [] })));
    }
    if (url === "/api/test-groups/4/manual-test-result-batches") {
      return Promise.resolve(
        new Response(JSON.stringify({ cases: [], batches: [] })),
      );
    }
    if (url === "/api/test-groups/4/report-history") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                record_type: "fact_report",
                id: 7,
                label: "最终报告 #7",
                status: "current",
                occurred_at: "2026-10-05T00:00:00Z",
              },
            ],
          }),
        ),
      );
    }
    if (url === "/api/test-groups/4/report-history?query=%E4%BA%BA%E5%B7%A5") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                record_type: "manual_result",
                id: 8,
                label: "人工记录批次 #2",
                status: "recorded",
                occurred_at: "2026-10-05T00:00:00Z",
              },
            ],
          }),
        ),
      );
    }
    if (url === "/api/fact-reports/7") {
      return Promise.resolve(new Response(JSON.stringify(report())));
    }
    if (url === "/api/fact-reports/7/attachment-cleanup-impact") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ...report().attachment_summary,
            report_id: 7,
            message: "只清理当前报告已使用附件。",
          }),
        ),
      );
    }
    if (
      url === "/api/fact-reports/7/used-attachments?confirm=true" &&
      init?.method === "DELETE"
    ) {
      cleaned = true;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url === "/api/fact-reports/7" && init?.method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`未预期请求：${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "confirm").mockReturnValue(true);

  render(<FactReportPanel groupId={4} />);
  expect(await screen.findByText("1 个，共 8 字节")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "清理已使用附件" }));
  expect(await screen.findByLabelText("附件清理影响确认")).toHaveTextContent(
    "只清理当前报告已使用附件。",
  );
  fireEvent.click(screen.getByRole("button", { name: "确认清理已使用附件" }));
  expect(
    await screen.findByText("evidence.txt：已使用，已清理"),
  ).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("查找自动化、人工记录和最终报告"), {
    target: { value: "人工" },
  });
  fireEvent.click(screen.getByRole("button", { name: "查找" }));
  expect(
    await screen.findByText("人工记录批次 #2：recorded"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "删除在线报告" }));
  expect(fetchMock).toHaveBeenCalledWith("/api/fact-reports/7", {
    method: "DELETE",
  });
});
