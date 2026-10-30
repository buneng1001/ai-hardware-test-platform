import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ManualResultsPage } from "./V020PrototypeManualResults";
import {
  callsOf,
  manualAttachment,
  manualBatch,
  manualCase,
  manualResult,
  openManualView,
  stubManualApi,
} from "./test/manualResultsHarness";
import { testGroupDetail } from "./test/testGroupFixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function renderPage() {
  render(
    <ManualResultsPage
      groupId={21}
      groupName="EVT1 基础回归"
      onBack={() => undefined}
    />,
  );
}

test("人工结果页展示人工/混合用例并恢复已保存结果和附件", async () => {
  stubManualApi({
    groups: [],
    cases: [
      manualCase(4, "SRC-001", "按键检查"),
      manualCase(5, "SRC-002", "混合检查", "mixed"),
    ],
    batches: [
      manualBatch(1, 1, [
        manualResult(10, 4, {
          status: "failed",
          actual_result: "按键无响应",
          notes: "已复现",
          attachments: [
            manualAttachment(20, "shot.png", {
              size_bytes: 2048,
              usage_status: "used",
            }),
          ],
        }),
      ]),
    ],
  });
  renderPage();

  expect(await screen.findByText("SRC-001")).toBeVisible();
  expect(screen.getByText("SRC-002")).toBeVisible();
  expect(screen.getByLabelText("SRC-001 测试结果")).toHaveValue("failed");
  expect(screen.getByLabelText("SRC-001 实际结果")).toHaveValue("按键无响应");
  expect(screen.getByLabelText("SRC-001 备注")).toHaveValue("已复现");
  expect(screen.getByRole("link", { name: "shot.png" })).toBeVisible();
  expect(screen.getByText(/2048 字节/)).toBeVisible();
  expect(screen.getByText(/已使用/)).toBeVisible();
  expect(screen.queryByText(/AUTO-/)).toBeNull();
});

test("支持逐行保存和整批保存，未填写项按未执行提交", async () => {
  const fetchMock = stubManualApi({
    groups: [],
    cases: [
      manualCase(4, "SRC-001", "按键检查"),
      manualCase(5, "SRC-002", "混合检查", "mixed"),
    ],
    batches: [],
  });
  renderPage();
  await screen.findByText("SRC-001");

  fireEvent.change(screen.getByLabelText("SRC-001 测试结果"), {
    target: { value: "failed" },
  });
  fireEvent.change(screen.getByLabelText("SRC-001 实际结果"), {
    target: { value: "按键无响应" },
  });
  fireEvent.change(screen.getByLabelText("SRC-001 备注"), {
    target: { value: "已复现" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存 SRC-001" }));
  expect(await screen.findByText("当前行已保存。")).toBeVisible();
  const created = callsOf(fetchMock).find(
    ([input, init]) =>
      String(input) === "/api/test-groups/21/manual-test-result-batches" &&
      init?.method === "POST",
  );
  const createdBody = JSON.parse(String(created?.[1]?.body)) as {
    results: Array<{ status: string; actual_result: string; notes: string }>;
  };
  expect(createdBody.results[0]).toMatchObject({
    status: "failed",
    actual_result: "按键无响应",
    notes: "已复现",
  });

  fireEvent.click(screen.getByRole("button", { name: "保存当前批次" }));
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          /\/manual-test-result-batches\/\d+$/.test(String(input)) &&
          init?.method === "PUT",
      ),
    ).toBe(true),
  );
  const updated = callsOf(fetchMock).find(
    ([input, init]) =>
      /\/manual-test-result-batches\/\d+$/.test(String(input)) &&
      init?.method === "PUT",
  );
  const updatedBody = JSON.parse(String(updated?.[1]?.body)) as {
    results: Array<{ status: string }>;
  };
  expect(updatedBody.results).toHaveLength(2);
  expect(updatedBody.results[1].status).toBe("not_executed");
});

test("保存后重新打开页面可以恢复编辑内容", async () => {
  stubManualApi({
    groups: [],
    cases: [manualCase(4, "SRC-001", "按键检查")],
    batches: [],
  });
  renderPage();
  await screen.findByText("SRC-001");
  fireEvent.change(screen.getByLabelText("SRC-001 测试结果"), {
    target: { value: "blocked" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存 SRC-001" }));
  await screen.findByText("当前行已保存。");

  cleanup();
  renderPage();
  expect(await screen.findByText("SRC-001")).toBeVisible();
  expect(screen.getByLabelText("SRC-001 测试结果")).toHaveValue("blocked");
});

test("人工结果和附件支持删除并提示报告过期", async () => {
  stubManualApi({
    groups: [],
    cases: [manualCase(4, "SRC-001", "按键检查")],
    batches: [
      manualBatch(1, 1, [
        manualResult(10, 4, {
          attachments: [manualAttachment(20, "shot.png")],
        }),
      ]),
    ],
  });
  renderPage();
  await screen.findByText("SRC-001");

  fireEvent.click(screen.getByRole("button", { name: "删除附件" }));
  expect(await screen.findByText("附件已删除。")).toBeVisible();
  expect(screen.queryByRole("link", { name: "shot.png" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "删除人工结果" }));
  expect(
    await screen.findByText("人工结果已删除；相关报告将在生成后标记为过期。"),
  ).toBeVisible();
});

test("新批次未填写项默认按未执行保存", async () => {
  const fetchMock = stubManualApi({
    groups: [],
    cases: [manualCase(4, "SRC-001", "按键检查")],
    batches: [],
  });
  renderPage();
  await screen.findByText("SRC-001");
  expect(screen.getByLabelText("SRC-001 测试结果")).toHaveValue("not_executed");

  fireEvent.click(screen.getByRole("button", { name: "保存 SRC-001" }));
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          String(input) === "/api/test-groups/21/manual-test-result-batches" &&
          init?.method === "POST",
      ),
    ).toBe(true),
  );
  const posted = callsOf(fetchMock).find(
    ([input, init]) =>
      String(input) === "/api/test-groups/21/manual-test-result-batches" &&
      init?.method === "POST",
  );
  const body = JSON.parse(String(posted?.[1]?.body)) as {
    results: Array<{ status: string }>;
  };
  expect(body.results[0].status).toBe("not_executed");
});

test("从执行与结果进入人工页时携带当前测试组", async () => {
  stubManualApi({
    groups: [testGroupDetail({ id: 21, name: "EVT1 基础回归" })],
    cases: [manualCase(4, "SRC-001", "按键检查")],
    batches: [],
  });
  await openManualView();

  expect(screen.getByText(/测试组：EVT1 基础回归/)).toBeVisible();
  expect(await screen.findByText("SRC-001")).toBeVisible();
});

test("人工结果加载失败可重试，没有人工用例时展示空状态", async () => {
  stubManualApi({
    groups: [],
    cases: [manualCase(4, "SRC-001", "按键检查")],
    batches: [],
    failTimes: 1,
  });
  renderPage();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "人工测试结果加载失败：人工结果服务暂时不可用",
  );
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("SRC-001")).toBeVisible();

  cleanup();
  stubManualApi({ groups: [], cases: [], batches: [] });
  renderPage();
  expect(await screen.findByText("当前测试组没有人工或混合用例")).toBeVisible();
});
