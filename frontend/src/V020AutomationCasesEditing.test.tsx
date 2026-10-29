import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  automationCase,
  callsOf,
  openAutomationView,
  stubApi,
} from "./test/sourceCasesHarness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("编辑保存后立即变为未校验并持久化修改内容", async () => {
  const fetchMock = stubApi({
    cases: [],
    records: [],
    automationCases: [automationCase({ id: 1 })],
  });
  await openAutomationView();

  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByLabelText("AUTO-000001 标题"), {
    target: { value: "录制并检查" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

  expect(
    await screen.findByText("修改已保存，当前用例已变为未校验。"),
  ).toBeVisible();
  expect(screen.getAllByText("未校验").length).toBeGreaterThan(0);
  const patched = callsOf(fetchMock).find(
    ([url, init]) =>
      String(url).endsWith("/automation-test-cases/1") &&
      init?.method === "PATCH",
  );
  const body = JSON.parse(String(patched?.[1]?.body)) as { title: string };
  expect(body.title).toBe("录制并检查");
});

test("新增自动化用例由系统生成编号并要求来源编号", async () => {
  const fetchMock = stubApi({ cases: [], records: [], automationCases: [] });
  await openAutomationView();

  fireEvent.click(screen.getByRole("button", { name: "新增自动化用例" }));
  fireEvent.change(screen.getByLabelText("来源用例编号"), {
    target: { value: "REC-002" },
  });
  fireEvent.change(screen.getByLabelText("新增自动化用例 标题"), {
    target: { value: "回放检查" },
  });
  fireEvent.change(screen.getByLabelText("新增自动化用例 操作步骤"), {
    target: { value: "播放" },
  });
  fireEvent.change(screen.getByLabelText("新增自动化用例 预期结果"), {
    target: { value: "成功" },
  });
  fireEvent.click(screen.getByRole("button", { name: "新增自动化用例" }));

  expect(await screen.findByText("AUTO-000099")).toBeVisible();
  expect(screen.getByText("已新增自动化用例，尚未校验。")).toBeVisible();
  const posted = callsOf(fetchMock).find(
    ([url, init]) =>
      String(url) === "/api/product-versions/11/automation-test-cases" &&
      init?.method === "POST",
  );
  const body = JSON.parse(String(posted?.[1]?.body)) as {
    source_case_number: string;
  };
  expect(body.source_case_number).toBe("REC-002");
});

test("删除自动化用例后移除资产并保留历史快照说明", async () => {
  const fetchMock = stubApi({
    cases: [],
    records: [],
    automationCases: [automationCase({ id: 1, case_number: "AUTO-000001" })],
  });
  await openAutomationView();

  fireEvent.click(screen.getByRole("button", { name: "删除" }));

  expect(
    await screen.findByText("自动化用例已删除；历史快照不受此操作影响。"),
  ).toBeVisible();
  expect(screen.queryByText("AUTO-000001")).toBeNull();
  expect(
    callsOf(fetchMock).some(
      ([url, init]) =>
        String(url).endsWith("/automation-test-cases/1") &&
        init?.method === "DELETE",
    ),
  ).toBe(true);
});

test("校验覆盖必填内容并阻止未通过校验的用例加入测试组", async () => {
  stubApi({
    cases: [],
    records: [],
    automationCases: [
      automationCase({ id: 1 }),
      automationCase({
        id: 2,
        case_number: "AUTO-000002",
        title: "",
        steps: "",
        expected_result: "",
      }),
    ],
  });
  await openAutomationView();

  fireEvent.click(screen.getByRole("button", { name: "校验自动化用例" }));

  expect(
    await screen.findByText(
      "存在未通过校验的自动化用例，不能加入测试组或执行。",
    ),
  ).toBeVisible();
  expect(screen.getByText(/标题不能为空/)).toBeVisible();
  expect(screen.getByText("已校验")).toBeVisible();
  expect(screen.getByText("校验失败")).toBeVisible();
  expect(screen.getByRole("button", { name: "加入测试组" })).toBeDisabled();
});

test("全部校验通过后才允许加入测试组", async () => {
  stubApi({
    cases: [],
    records: [],
    automationCases: [automationCase({ id: 1 })],
  });
  await openAutomationView();
  const joinGroup = screen.getByRole("button", { name: "加入测试组" });
  expect(joinGroup).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "校验自动化用例" }));

  expect(await screen.findByText("自动化用例校验通过。")).toBeVisible();
  expect(joinGroup).toBeEnabled();
});

test("批量保存一次提交多条已修改用例", async () => {
  const fetchMock = stubApi({
    cases: [],
    records: [],
    automationCases: [
      automationCase({ id: 1, case_number: "AUTO-000001" }),
      automationCase({
        id: 2,
        case_number: "AUTO-000002",
        source_case_number: "REC-002",
      }),
    ],
  });
  await openAutomationView();

  fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByLabelText("AUTO-000001 标题"), {
    target: { value: "标题一" },
  });
  fireEvent.change(screen.getByLabelText("AUTO-000002 标题"), {
    target: { value: "标题二" },
  });

  const batchSave = screen.getByRole("button", { name: "批量保存修改" });
  expect(batchSave).toBeEnabled();
  fireEvent.click(batchSave);

  expect(await screen.findByText("已提交 2 条修改。")).toBeVisible();
  const patched = callsOf(fetchMock).filter(
    ([url, init]) =>
      /\/automation-test-cases\/\d+$/.test(String(url)) &&
      init?.method === "PATCH",
  );
  expect(patched).toHaveLength(2);
});

test("存在未保存编辑时提示浏览器确认离开页面", async () => {
  stubApi({
    cases: [],
    records: [],
    automationCases: [automationCase({ id: 1 })],
  });
  await openAutomationView();

  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByLabelText("AUTO-000001 标题"), {
    target: { value: "未保存标题" },
  });

  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
