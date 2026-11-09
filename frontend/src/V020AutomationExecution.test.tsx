import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { V020AutomationExecutionPanel } from "./V020AutomationExecutionPanel";
import { useV020AutomationExecution } from "./useV020AutomationExecution";

/** 测试外壳：执行入口在面板外，与详情页顶部按钮保持一致。 */
function PanelHarness({ groupId }: { groupId: number }) {
  const execution = useV020AutomationExecution(groupId);
  return (
    <>
      <button onClick={() => void execution.run()} type="button">
        执行自动化测试
      </button>
      <button
        disabled={!execution.busy}
        onClick={() => execution.cancelRun()}
        type="button"
      >
        取消本次测试
      </button>
      <V020AutomationExecutionPanel execution={execution} />
    </>
  );
}
import { testGroupDetail } from "./test/testGroupFixtures";
import {
  callsOf,
  executionRecord,
  openResultsView,
  stubExecutionApi,
} from "./test/automationExecutionHarness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const preparationFailure = {
  passed: false,
  checks: [
    {
      code: "PREP_CASE_DATA_MISSING",
      object_type: "automation_test_case" as const,
      object_id: 1,
      actual: "未关联数据包",
      expected: "至少关联 1 个已校验的数据包",
      suggestion: "为该自动化用例关联已校验数据包。",
      action: "replace_data_packages" as const,
    },
  ],
};

test("执行与结果页展示真实执行记录并按测试组切换", async () => {
  const state = {
    groups: [
      testGroupDetail({ id: 21, name: "EVT1 基础回归" }),
      testGroupDetail({ id: 22, name: "EVT1 故障专项" }),
    ],
    executions: [executionRecord({ test_group_id: 21 })],
  };
  const fetchMock = stubExecutionApi(state);
  await openResultsView();

  expect(await screen.findByText("自动化执行 #1")).toBeVisible();
  expect(screen.getByText("已完成")).toBeVisible();
  expect(screen.getByText("通过 1 · 失败 0 · 阻塞 0 · 未执行 0")).toBeVisible();
  expect(screen.getByLabelText("当前测试组")).toHaveValue("21");

  const recordCalls = () =>
    callsOf(fetchMock).filter(([input]) =>
      String(input).endsWith("/test-groups/21/automation-executions"),
    ).length;
  const beforeRefresh = recordCalls();
  fireEvent.click(screen.getByRole("button", { name: "刷新最新结果" }));
  await waitFor(() => expect(recordCalls()).toBeGreaterThan(beforeRefresh));

  fireEvent.change(screen.getByLabelText("当前测试组"), {
    target: { value: "22" },
  });
  expect(
    await screen.findByText(/当前测试组还没有自动化执行记录/),
  ).toBeVisible();
  expect(
    callsOf(fetchMock).some(([input]) =>
      String(input).endsWith("/test-groups/22/automation-executions"),
    ),
  ).toBe(true);
});

test("准备检查失败展示完整可操作信息且不创建执行记录", async () => {
  const fetchMock = stubExecutionApi({
    groups: [testGroupDetail({ id: 21 })],
    executions: [],
    preparation: preparationFailure,
  });
  render(<PanelHarness groupId={21} />);

  fireEvent.click(
    await screen.findByRole("button", { name: "执行自动化测试" }),
  );
  expect(await screen.findByText("PREP_CASE_DATA_MISSING")).toBeVisible();
  expect(screen.getByText("失败对象：automation_test_case #1")).toBeVisible();
  expect(screen.getByText("实际值：未关联数据包")).toBeVisible();
  expect(screen.getByText("期望值：至少关联 1 个已校验的数据包")).toBeVisible();
  expect(
    screen.getByText("修复建议：为该自动化用例关联已校验数据包。"),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "替换数据包" })).toHaveAttribute(
    "href",
    "#test-group-automation-scope",
  );
  expect(
    callsOf(fetchMock).filter(
      ([input, init]) =>
        String(input).endsWith("/automation-executions") &&
        init?.method === "POST",
    ),
  ).toHaveLength(0);

  expect(
    await screen.findByText("预检未通过，请按提示修复后再执行。"),
  ).toBeVisible();

  // 再点一次仍只做预检，不创建执行记录
  fireEvent.click(screen.getByRole("button", { name: "执行自动化测试" }));
  await waitFor(() =>
    expect(
      callsOf(fetchMock).filter(
        ([input, init]) =>
          String(input).endsWith("/automation-execution-preparations") &&
          init?.method === "POST",
      ),
    ).toHaveLength(2),
  );
  expect(
    callsOf(fetchMock).filter(
      ([input, init]) =>
        String(input).endsWith("/automation-executions") &&
        init?.method === "POST",
    ),
  ).toHaveLength(0);
});

test("准备通过后可执行，再次执行产生新的不可覆盖记录", async () => {
  const fetchMock = stubExecutionApi({
    groups: [testGroupDetail({ id: 21 })],
    executions: [],
  });
  render(<PanelHarness groupId={21} />);

  fireEvent.click(
    await screen.findByRole("button", { name: "执行自动化测试" }),
  );
  fireEvent.click(screen.getByText(/历史执行记录/));
  expect(await screen.findByText("自动化执行 #1")).toBeVisible();
  expect(
    await screen.findByText("执行完成：通过 1 · 失败 0 · 阻塞 0 · 未执行 0。"),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "执行自动化测试" }));
  expect(await screen.findByText("自动化执行 #2")).toBeVisible();
  expect(screen.getByText("自动化执行 #1")).toBeVisible();
  expect(
    callsOf(fetchMock).filter(
      ([input, init]) =>
        String(input).endsWith("/automation-executions") &&
        init?.method === "POST",
    ),
  ).toHaveLength(2);
});

test("执行结果展示通过、失败、阻塞和未执行并说明已完成含义", async () => {
  const failed = executionRecord({
    status: "completed",
    summary: { passed: 1, failed: 1, blocked: 1, not_executed: 1 },
    case_results: [
      {
        automation_test_case_id: 1,
        case_number: "AUTO-000001",
        title: "正常录制",
        position: 1,
        status: "passed",
        message: "确定性数据检查结果符合用例预期。",
      },
      {
        automation_test_case_id: 2,
        case_number: "AUTO-000002",
        title: "掉帧检测",
        position: 2,
        status: "failed",
        message: "确定性检查实际结果：video_drop；未满足用例预期。",
      },
      {
        automation_test_case_id: 3,
        case_number: "AUTO-000003",
        title: "阻塞用例",
        position: 3,
        status: "blocked",
        message: "缺少可执行数据。",
      },
      {
        automation_test_case_id: 4,
        case_number: "AUTO-000004",
        title: "未执行用例",
        position: 4,
        status: "not_executed",
        message: "计划项未开始。",
      },
    ],
  });
  stubExecutionApi({
    groups: [testGroupDetail({ id: 21 })],
    executions: [failed],
  });
  render(<PanelHarness groupId={21} />);

  fireEvent.click(await screen.findByText(/历史执行记录/));
  expect(
    await screen.findByText(/确定性检查实际结果：video_drop/),
  ).toBeVisible();
  expect(screen.getByText("失败")).toBeVisible();
  expect(screen.getByText("阻塞")).toBeVisible();
  expect(screen.getByText("未执行")).toBeVisible();
  expect(screen.getByText(/“已完成”表示所有计划项都已完成尝试/)).toBeVisible();
  expect(screen.getAllByText(/不连接真实设备/).length).toBeGreaterThan(0);
});

test("执行记录加载失败时可以重试", async () => {
  stubExecutionApi({
    groups: [testGroupDetail({ id: 21 })],
    executions: [],
    failRecordsTimes: 1,
  });
  render(<PanelHarness groupId={21} />);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "自动化执行记录加载失败：执行记录服务暂时不可用",
  );

  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(
    await screen.findByRole("button", { name: "执行自动化测试" }),
  ).toBeVisible();
});
