import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { V030ReportTaskMonitor } from "./V030ReportTaskMonitor";
import { factReport, completedAnalysis } from "./test/reportFixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

test("后台任务默认收起，完成通知跳转到同一份报告的 AI 分析入口", async () => {
  vi.useFakeTimers();
  let running = true;
  let completed = false;
  const active = {
    invocation_id: "run14",
    operation_type: "report_analysis",
    resource_id: 14,
    project_id: 6,
    status: "running",
    stopping: false,
    started_at: new Date(Date.now() - 120000).toISOString(),
  };
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const value = url.endsWith("active-invocation")
      ? { active: running ? active : null }
      : factReport({
          id: 14,
          analysis: completed
            ? completedAnalysis()
            : { status: "pending", message: "运行中", output: null },
        });
    return Promise.resolve(new Response(JSON.stringify(value)));
  });
  const navigation = vi.fn();
  const onNavigate = (event: Event) =>
    navigation((event as CustomEvent).detail);
  window.addEventListener("v030-open-report-target", onNavigate);
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <>
      <main key="one">页面一</main>
      <V030ReportTaskMonitor />
    </>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(
    screen.getByRole("button", { name: "展开后台 AI 任务" }),
  ).toBeVisible();
  expect(screen.queryByLabelText("后台 AI 任务详情")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开后台 AI 任务" }));
  expect(screen.getByLabelText("后台 AI 任务详情")).toBeVisible();

  view.rerender(
    <>
      <main key="two">页面二</main>
      <V030ReportTaskMonitor />
    </>,
  );
  expect(screen.getByText("页面二")).toBeVisible();
  running = false;
  completed = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(screen.getByText("报告 #14 · AI 分析已完成")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查看 AI 分析" }));
  expect(navigation).toHaveBeenCalledWith({ reportId: 14, target: "ai" });
  expect(
    screen.getByRole("button", { name: "展开 AI 任务完成通知" }),
  ).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.querySelector(".v030-report-task-stack")).toBeInTheDocument();
  window.removeEventListener("v030-open-report-target", onNavigate);
});

test("a completion notice and a new running indicator keep a visible gap", async () => {
  vi.useFakeTimers();
  const first = {
    invocation_id: "run14",
    operation_type: "report_analysis",
    resource_id: 14,
    project_id: 6,
    status: "running",
    stopping: false,
    started_at: new Date().toISOString(),
  };
  const second = {
    ...first,
    invocation_id: "run15",
    resource_id: 15,
  };
  let current = first;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const value = url.endsWith("active-invocation")
        ? { active: current }
        : factReport({ id: 14, analysis: completedAnalysis() });
      return Promise.resolve(new Response(JSON.stringify(value)));
    }),
  );
  const { container } = render(<V030ReportTaskMonitor />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  current = second;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });

  const stack = container.querySelector(".v030-report-task-stack");
  expect(stack?.querySelector(".v030-task-indicator")).toBeInTheDocument();
  expect(stack?.querySelector(".v030-report-task-notice")).toBeInTheDocument();
  expect(stack?.children).toHaveLength(2);
});

test("a failed retry with an older successful result does not emit success", async () => {
  vi.useFakeTimers();
  let running = true;
  const active = {
    invocation_id: "retry",
    operation_type: "report_analysis",
    resource_id: 14,
    project_id: 6,
    status: "running",
    stopping: false,
    started_at: new Date().toISOString(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(input).endsWith("active-invocation")
              ? { active: running ? active : null }
              : factReport({
                  id: 14,
                  analysis: {
                    ...completedAnalysis(),
                    progress: {
                      invocation_id: "retry",
                      status: running ? "running" : "failed",
                      started_at: active.started_at,
                      phase: "model_request",
                      completed_batches: 3,
                      total_batches: 6,
                      saved_units: 3,
                    },
                  },
                }),
          ),
        ),
      ),
    ),
  );
  render(<V030ReportTaskMonitor />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText(/3\/6 批/)).toBeVisible();
  running = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(
    screen.getByText("报告 #14 · AI 分析未成功，请查看报告"),
  ).toBeVisible();
  expect(screen.queryByText("报告 #14 · AI 分析已完成")).toBeNull();
});

test("regression task monitor shows real streamed response progress", async () => {
  vi.useFakeTimers();
  const active = {
    invocation_id: "regression-stream-23",
    operation_type: "intelligent_regression",
    resource_id: 23,
    project_id: 6,
    status: "running",
    stopping: false,
    started_at: new Date().toISOString(),
  };
  sessionStorage.setItem("v030-observed-report-ai", JSON.stringify(active));
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const value = url.endsWith("active-invocation")
        ? { active }
        : url.endsWith("/intelligent-regression/progress")
          ? {
              invocation_id: active.invocation_id,
              status: "running",
              started_at: active.started_at,
              stopping: false,
              phase: "module_analysis",
              current_batch_index: 1,
              completed_batches: 0,
              total_batches: 16,
              current_module: "录像异常恢复",
              stream_response_chars: 128,
              stream_event_count: 10,
              stream_last_chunk_at: new Date().toISOString(),
            }
          : { project_id: 6, result: null };
      return Promise.resolve(new Response(JSON.stringify(value)));
    }),
  );
  render(<V030ReportTaskMonitor />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  fireEvent.click(screen.getByRole("button", { name: "展开后台 AI 任务" }));
  expect(screen.getByText(/模型响应已返回 128 字符/)).toBeVisible();
  expect(screen.getByText(/录像异常恢复/)).toBeVisible();
});

test("regression completion notice keeps the persisted model failure reason after leaving the page", async () => {
  vi.useFakeTimers();
  const active = {
    invocation_id: "regression-23",
    operation_type: "intelligent_regression",
    resource_id: 23,
    project_id: 6,
    status: "running",
    stopping: false,
    started_at: new Date().toISOString(),
  };
  sessionStorage.setItem("v030-observed-report-ai", JSON.stringify(active));
  sessionStorage.setItem(
    "v030-regression-error:23",
    JSON.stringify({
      message: "模型响应传输中断（错误类型：network · RemoteDisconnected）",
      createdAt: Date.now(),
    }),
  );
  const navigation = vi.fn();
  const onNavigate = (event: Event) =>
    navigation((event as CustomEvent).detail);
  window.addEventListener("v030-open-report-target", onNavigate);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const value = url.endsWith("active-invocation")
        ? { active: null }
        : { project_id: 6, result: null };
      return Promise.resolve(new Response(JSON.stringify(value)));
    }),
  );
  render(<V030ReportTaskMonitor />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText(/智能回归生成失败：模型响应传输中断/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查看回归建议" }));
  expect(navigation).toHaveBeenCalledWith({
    reportId: 23,
    target: "regression",
  });
  window.removeEventListener("v030-open-report-target", onNavigate);
});

test("completed notices can collapse to a compact indicator and reopen", async () => {
  vi.useFakeTimers();
  let running = true;
  const active = {
    invocation_id: "run15",
    operation_type: "report_analysis",
    resource_id: 15,
    project_id: 6,
    status: "running",
    stopping: false,
    started_at: new Date().toISOString(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(input).endsWith("active-invocation")
              ? { active: running ? active : null }
              : factReport({ id: 15, analysis: completedAnalysis() }),
          ),
        ),
      ),
    ),
  );
  render(<V030ReportTaskMonitor />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  running = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(screen.getByText("报告 #15 · AI 分析已完成")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "收起" }));
  expect(
    screen.getByRole("button", { name: "展开 AI 任务完成通知" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "展开 AI 任务完成通知" }));
  expect(screen.getByText("报告 #15 · AI 分析已完成")).toBeVisible();
});
