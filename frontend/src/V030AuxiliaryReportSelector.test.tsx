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

test("empty candidates do not block validation, failed validation permits remove", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(
      new Response(
        init?.method === "POST"
          ? JSON.stringify({ detail: "invalid report" })
          : JSON.stringify({ items: [] }),
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
  await screen.findByText(/当前项目暂无可选的其他最终测试报告/);
  fireEvent.click(screen.getByRole("button", { name: "校验辅助报告选择" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "移除失效选择" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "移除失效选择" }));
  expect(screen.queryByRole("button", { name: "移除失效选择" })).toBeNull();
});

test("T15 requires completed analysis and global AI, then renders a validated result", async () => {
  const generated = {
    is_mock: true,
    overall_risk: { content: "风险判断", evidence_refs: [] },
    key_changes: null,
    regression_focus: { content: "复测方向", evidence_refs: [] },
    summary: "本次共生成 1 条候选",
    candidates: [
      {
        id: 1,
        title: "录制回归",
        case_type: "manual",
        module: "录像",
        priority: "high",
        reason: "事实失败",
      },
    ],
  };
  let saved: typeof generated | null = null;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let result: unknown = { items: options };
    if (url.endsWith("/state")) result = { enabled: true, can_enable: true };
    if (url.endsWith("/active-invocation")) result = { active: null };
    if (url.endsWith("/current")) result = { project_id: 1, result: saved };
    if (url.endsWith("/repeat-info"))
      result = {
        same_input: false,
        running_same_operation: false,
        occupied_other: false,
        active_invocation_id: null,
      };
    if (url.endsWith("/intelligent-regression")) {
      expect(JSON.parse(String(init?.body))).toEqual({ report_ids: [21] });
      saved = generated;
      result = generated;
    }
    return Promise.resolve(new Response(JSON.stringify(result)));
  });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <V030AuxiliaryReportSelector reportId={23} analysisStatus="failed" />,
  );
  const button = screen.getByRole("button", {
    name: "生成智能回归建议",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  view.rerender(
    <V030AuxiliaryReportSelector reportId={23} analysisStatus="completed" />,
  );
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "搜索 / 选择辅助报告" }));
  fireEvent.click(await screen.findByRole("option", { name: /EVT2.*Camera/ }));
  fireEvent.click(button);
  await screen.findByText("本次共生成 1 条候选");
  expect(screen.getByText("录制回归")).toBeTruthy();
  expect(screen.getByText(/未选择辅助报告/)).toBeTruthy();
});

test("T16 restores the project current recommendation and confirms same-input replacement without overwrite toggle", async () => {
  const result = (summary: string) => ({
    project_id: 1,
    main_report_id: 23,
    invocation_id: summary,
    generated_at: "2026-11-24T13:00:00Z",
    is_mock: true,
    overall_risk: { content: "风险", evidence_refs: [] },
    key_changes: null,
    regression_focus: { content: "重点", evidence_refs: [] },
    summary,
    candidates: [
      {
        id: 1,
        title: "回归用例",
        case_type: "manual",
        module: "录像",
        priority: "high",
        reason: "复测",
      },
    ],
  });
  let saved = result("旧建议");
  let failure = true;
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    let payload: unknown = { items: options };
    if (url.endsWith("/state")) payload = { enabled: true, can_enable: true };
    else if (url.endsWith("/active-invocation")) payload = { active: null };
    else if (url.endsWith("/current"))
      payload = { project_id: 1, result: saved };
    else if (url.endsWith("/repeat-info"))
      payload = {
        same_input: true,
        running_same_operation: false,
        occupied_other: false,
        active_invocation_id: null,
      };
    else if (url.endsWith("/intelligent-regression?force=true")) {
      if (failure)
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "保存失败" }), { status: 500 }),
        );
      saved = result("新建议");
      payload = saved;
    }
    return Promise.resolve(new Response(JSON.stringify(payload)));
  });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <V030AuxiliaryReportSelector
      reportId={23}
      groupId={7}
      analysisStatus="completed"
    />,
  );
  await screen.findByText("旧建议");
  const button = screen.getByRole("button", {
    name: "生成智能回归建议",
  }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByRole("dialog", { name: "确认重复生成智能回归建议" });
  expect(screen.queryByText("覆盖上一次结果")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByText("旧建议")).toBeTruthy();
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("button", { name: "重新执行" }));
  await screen.findByText("保存失败");
  expect(screen.getByText("旧建议")).toBeTruthy();
  failure = false;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("button", { name: "重新执行" }));
  await screen.findByText("新建议");
  expect(screen.queryByText("旧建议")).toBeNull();
  view.unmount();
  render(
    <V030AuxiliaryReportSelector
      reportId={null}
      groupId={7}
      analysisStatus="missing"
    />,
  );
  await screen.findByText("新建议");
  expect(
    (
      screen.getByRole("button", {
        name: "生成智能回归建议",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("T16 running repeat cancels exact old invocation and waits before sending a new request", async () => {
  let cancelled = false;
  let released = false;
  let started = false;
  const fresh = {
    project_id: 1,
    main_report_id: 23,
    invocation_id: "new",
    is_mock: true,
    overall_risk: { content: "风险", evidence_refs: [] },
    key_changes: null,
    regression_focus: { content: "重点", evidence_refs: [] },
    summary: "已重新生成",
    candidates: [
      {
        id: 1,
        title: "回归",
        case_type: "manual",
        module: "录像",
        priority: "high",
        reason: "复测",
      },
    ],
  };
  let saved: typeof fresh | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      let payload: unknown = { items: [] };
      if (url.endsWith("/state")) payload = { enabled: true, can_enable: true };
      else if (url.endsWith("/current"))
        payload = { project_id: 1, result: saved };
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
          running_same_operation: true,
          occupied_other: false,
          active_invocation_id: "old",
        };
      else if (url.endsWith("/invocations/old/cancel")) {
        cancelled = true;
        payload = {};
      } else if (url.endsWith("/intelligent-regression?force=true")) {
        expect(cancelled).toBe(true);
        expect(released).toBe(true);
        started = true;
        saved = fresh;
        payload = fresh;
      }
      return Promise.resolve(new Response(JSON.stringify(payload)));
    }),
  );
  render(
    <V030AuxiliaryReportSelector
      reportId={23}
      groupId={7}
      analysisStatus="completed"
    />,
  );
  const button = screen.getByRole("button", {
    name: "生成智能回归建议",
  }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("button", { name: "重新执行" }));
  await waitFor(() => expect(cancelled).toBe(true));
  expect(started).toBe(false);
  released = true;
  await screen.findByText("已重新生成", {}, { timeout: 3000 });
  expect(started).toBe(true);
});
