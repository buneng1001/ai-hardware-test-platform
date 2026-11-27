import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { V030AuxiliaryReportSelector } from "./V030AuxiliaryReportSelector";

const options = [
  {
    id: 21,
    product_version: "EVT2",
    test_group: "Camera",
    created_at: "2026-11-20T10:00:00Z",
    analysis_status: "failed",
  },
  {
    id: 19,
    product_version: "EVT1",
    test_group: "Audio",
    created_at: "2026-11-18T10:00:00Z",
    analysis_status: "completed",
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
test("reopening the regression section restores the latest main-only failure reason", async () => {
  sessionStorage.setItem(
    "v030-regression-error:23",
    JSON.stringify({
      message: "模型响应传输中断（错误类型：network）",
      createdAt: Date.now(),
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/state"))
        return Promise.resolve(
          new Response(JSON.stringify({ enabled: true, can_enable: true })),
        );
      if (url.endsWith("/active-invocation"))
        return Promise.resolve(new Response(JSON.stringify({ active: null })));
      if (url.endsWith("/current"))
        return Promise.resolve(
          new Response(JSON.stringify({ project_id: 1, result: null })),
        );
      return Promise.resolve(new Response(JSON.stringify({ items: options })));
    }),
  );
  render(
    <V030AuxiliaryReportSelector reportId={23} analysisStatus="completed" />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "模型响应传输中断",
  );
  expect(screen.getByRole("alert")).toHaveTextContent("network");
});

test("tags, search/version intersection, selected exclusion and empty states", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(new Response(JSON.stringify({ items: options }))),
    ),
  );
  render(<V030AuxiliaryReportSelector reportId={23} />);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "搜索 / 选择辅助报告" }));
  await screen.findByRole("option", { name: /EVT2.*Camera/ });
  fireEvent.change(screen.getByRole("textbox", { name: "搜索辅助报告" }), {
    target: { value: "Camera" },
  });
  expect(screen.getAllByRole("option", { name: /Camera/ })).toHaveLength(1);
  fireEvent.change(screen.getByRole("combobox", { name: "辅助报告版本筛选" }), {
    target: { value: "EVT1" },
  });
  expect(screen.getByText(/没有找到符合条件的报告/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清除搜索和筛选" }));
  fireEvent.click(screen.getByRole("option", { name: /EVT2.*Camera/ }));
  expect(screen.queryByRole("option", { name: /EVT2.*Camera/ })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索辅助报告" }), {
    target: { value: "does not exist" },
  });
  expect(screen.getByRole("button", { name: "移除辅助报告 #21" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "移除辅助报告 #21" }));
  expect(screen.queryByRole("button", { name: "移除辅助报告 #21" })).toBeNull();
});

test("selection automatically validates, failed validation permits remove", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(
      new Response(
        init?.method === "POST"
          ? JSON.stringify({ detail: "invalid report" })
          : JSON.stringify({ items: options }),
        {
          status: init?.method === "POST" ? 422 : 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<V030AuxiliaryReportSelector reportId={23} />);
  fireEvent.click(screen.getByRole("button", { name: "搜索 / 选择辅助报告" }));
  fireEvent.click(await screen.findByRole("option", { name: /EVT2.*Camera/ }));
  expect(screen.queryByRole("button", { name: "校验辅助报告选择" })).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "移除失效选择" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "移除失效选择" }));
  expect(screen.queryByRole("button", { name: "移除失效选择" })).toBeNull();
});

function regressionResult(summary: string, invocationId = summary) {
  const source = { report_id: 23, evidence_ref: "record:0:0" };
  const explanation = (content: string) => ({
    content,
    evidence_refs: [source],
  });
  return {
    schema_version: 2,
    generation_status: "complete_ai",
    project_id: 1,
    main_report_id: 23,
    main_product_version_id: 3,
    auxiliary_report_ids: [],
    input_fingerprint: "input",
    ai_context_fingerprint: "context",
    report_fingerprints: { "23": "fingerprint" },
    invocation_id: invocationId,
    config_fingerprint: "config",
    is_mock: false,
    generated_at: "2026-11-26T06:00:00Z",
    prompt_version: "intelligent-regression-v9-full-ai-analysis",
    invocation_status: "completed",
    analysis_sections: {
      regression_necessity: explanation("需要对报告发现开展定向回归。"),
      impact_analysis: explanation("异常可能影响设备恢复后的文件状态。"),
      execution_strategy: explanation("先复测原用例，再补足独立覆盖缺口。"),
      execution_readiness: explanation("执行前确认设备、版本和测试数据。"),
    },
    key_changes: null,
    review_notes: [],
    deferred_targets: [],
    summary,
    modules: ["录像"],
    existing_case_recommendations: [],
    candidate_count: 1,
    candidates: [{
      id: 1,
      title: "录像异常恢复后的文件完整性",
      case_type: "manual",
      test_type: "回归测试",
      module: "录像",
      priority: "high",
      test_item: "异常恢复与文件完整性",
      reason: "报告证据表明恢复路径需要独立验证。",
      preconditions: "目标设备和软件版本已部署。",
      input: "使用报告中的设备和测试数据。",
      steps: "1. 执行异常恢复场景\n2. 检查文件状态",
      expected_result: "文件可读取且内容完整。",
      sources: [source],
      source_findings: [{
        ...source,
        product_version: "EVT2",
        finding: "报告记录了恢复路径异常。",
      }],
      completion_status: "ready",
    }],
  };
}

test("AI is mandatory: generation is blocked when global AI is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/state"))
      return Promise.resolve(new Response(JSON.stringify({ enabled: false, can_enable: false })));
    if (url.endsWith("/active-invocation"))
      return Promise.resolve(new Response(JSON.stringify({ active: null })));
    if (url.endsWith("/current"))
      return Promise.resolve(new Response(JSON.stringify({ project_id: 1, result: null })));
    return Promise.resolve(new Response(JSON.stringify({ items: options })));
  }));
  render(<V030AuxiliaryReportSelector reportId={23} analysisStatus="completed" />);
  const button = screen.getByRole("button", { name: "生成智能回归建议" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(true));
  expect(screen.getByText("请先开启全局 AI")).toBeTruthy();
});

test("one click automatically runs AI analysis and publishes the four-section regression plan", async () => {
  const generated = regressionResult("已完成完整 AI 回归分析");
  const submitted: unknown[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let result: unknown = { items: options };
    if (url.endsWith("/state")) result = { enabled: true, can_enable: true };
    else if (url.endsWith("/active-invocation")) result = { active: null };
    else if (url.endsWith("/current")) result = { project_id: 1, result: null };
    else if (url.endsWith("/repeat-info")) {
      expect(JSON.parse(String(init?.body))).toEqual({ report_ids: [21] });
      result = {
        same_input: false,
        has_previous: false,
        running_same_operation: false,
        occupied_other: false,
        active_invocation_id: null,
        resume_available: false,
        completed_batches: 0,
        total_batches: 1,
        completed_modules: [],
        total_modules: 1,
      };
    } else if (url.endsWith("/validate")) result = { valid: true };
    else if (url.endsWith("/intelligent-regression")) {
      const body = JSON.parse(String(init?.body));
      submitted.push(body);
      expect(body).toEqual({ report_ids: [21], resume: false });
      result = generated;
    }
    return Promise.resolve(new Response(JSON.stringify(result)));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<V030AuxiliaryReportSelector reportId={23} analysisStatus="completed" />);
  const button = screen.getByRole("button", { name: "生成智能回归建议" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "搜索 / 选择辅助报告" }));
  fireEvent.click(await screen.findByRole("option", { name: /EVT2.*Camera/ }));
  fireEvent.click(button);
  await screen.findByText("已完成完整 AI 回归分析");
  expect(submitted).toEqual([{ report_ids: [21], resume: false }]);
  expect(screen.getByText("01 回归必要性与范围判断")).toBeTruthy();
  expect(screen.getByText("02 影响链路与风险分析")).toBeTruthy();
  expect(screen.getByText("03 回归策略与执行顺序")).toBeTruthy();
  expect(screen.getByText("04 执行准备与验收边界")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /AI 增强当前回归建议/ })).toBeNull();
  expect(screen.queryByText(/本地整理/)).toBeNull();
});

test("same-input confirmation and a failed regeneration preserve the previous complete result", async () => {
  const oldResult = regressionResult("旧版完整 AI 建议", "old-run");
  const newResult = regressionResult("新版完整 AI 建议", "new-run");
  let saved = oldResult;
  let fail = true;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let payload: unknown = { items: options };
    if (url.endsWith("/state")) payload = { enabled: true, can_enable: true };
    else if (url.endsWith("/active-invocation")) payload = { active: null };
    else if (url.endsWith("/current")) payload = { project_id: 1, result: saved };
    else if (url.endsWith("/repeat-info")) {
      expect(JSON.parse(String(init?.body))).toEqual({ report_ids: [] });
      payload = {
        same_input: true,
        has_previous: true,
        running_same_operation: false,
        occupied_other: false,
        active_invocation_id: null,
        resume_available: false,
        completed_batches: 0,
        total_batches: 1,
        completed_modules: [],
        total_modules: 1,
      };
    } else if (url.endsWith("/intelligent-regression?force=true")) {
      expect(JSON.parse(String(init?.body))).toEqual({ report_ids: [], resume: false });
      if (fail)
        return Promise.resolve(new Response(JSON.stringify({ detail: "AI 连接失败" }), { status: 422 }));
      saved = newResult;
      payload = newResult;
    }
    return Promise.resolve(new Response(JSON.stringify(payload)));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<V030AuxiliaryReportSelector reportId={23} groupId={7} analysisStatus="completed" />);
  await screen.findByText("旧版完整 AI 建议");
  const button = screen.getByRole("button", { name: "生成智能回归建议" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByRole("dialog", { name: "确认重复生成智能回归建议" });
  fireEvent.click(screen.getByRole("button", { name: "重新生成全部" }));
  await screen.findByText("AI 连接失败");
  expect(screen.getByText("旧版完整 AI 建议")).toBeTruthy();
  fail = false;
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("button", { name: "重新生成全部" }));
  await screen.findByText("新版完整 AI 建议");
  expect(screen.queryByText("旧版完整 AI 建议")).toBeNull();
});

test("running repeat cancels the exact invocation and waits before sending a new AI request", async () => {
  let cancelled = false;
  let released = false;
  let started = false;
  const fresh = regressionResult("已重新生成完整回归方案", "new-run");
  let saved: typeof fresh | null = null;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let payload: unknown = { items: [] };
    if (url.endsWith("/state")) payload = { enabled: true, can_enable: true };
    else if (url.endsWith("/current")) payload = { project_id: 1, result: saved };
    else if (url.endsWith("/active-invocation"))
      payload = {
        active: released
          ? null
          : {
              invocation_id: "old",
              operation_type: "intelligent_regression",
              project_id: 1,
              resource_id: 23,
              stopping: cancelled,
            },
      };
    else if (url.endsWith("/repeat-info"))
      payload = {
        same_input: false,
        has_previous: false,
        running_same_operation: true,
        occupied_other: false,
        active_invocation_id: "old",
        resume_available: false,
        completed_batches: 0,
        total_batches: 1,
        completed_modules: [],
        total_modules: 1,
      };
    else if (url.endsWith("/invocations/old/cancel")) {
      cancelled = true;
      payload = {};
    } else if (url.endsWith("/intelligent-regression?force=true")) {
      expect(JSON.parse(String(init?.body))).toEqual({ report_ids: [], resume: false });
      expect(cancelled).toBe(true);
      expect(released).toBe(true);
      started = true;
      saved = fresh;
      payload = fresh;
    }
    return Promise.resolve(new Response(JSON.stringify(payload)));
  }));
  render(<V030AuxiliaryReportSelector reportId={23} groupId={7} analysisStatus="completed" />);
  const button = screen.getByRole("button", { name: "生成智能回归建议" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("button", { name: "停止后重新执行" }));
  await waitFor(() => expect(cancelled).toBe(true));
  expect(started).toBe(false);
  released = true;
  await screen.findByText("已重新生成完整回归方案", {}, { timeout: 3000 });
  expect(started).toBe(true);
});