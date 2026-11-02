import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { dataPackage } from "./test/dataPackagesHarness";
import {
  groupAutomationCase,
  groupSourceCase,
  testGroupDetail,
} from "./test/testGroupFixtures";
import {
  callsOf,
  openGroupsView,
  stubGroupsApi,
  type GroupStubState,
} from "./test/testGroupsHarness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const packages = [
  dataPackage({ id: 7, package_number: "DP-000007" }),
  dataPackage({ id: 8, package_number: "DP-000008" }),
];

function detailState(overrides: Partial<GroupStubState> = {}) {
  return {
    groups: [testGroupDetail({})],
    sourceCases: [],
    automationCases: [],
    packages,
    ...overrides,
  } satisfies GroupStubState;
}

async function openDetailWith(state: GroupStubState) {
  stubGroupsApi(state);
  await openGroupsView();
  fireEvent.click(await screen.findByRole("button", { name: "编辑设置" }));
  await screen.findByRole("button", { name: "执行自动化测试" });
}

test("测试组详情用一张表列出人工与自动化用例并支持移出", async () => {
  const fetchMock = stubGroupsApi(
    detailState({
      groups: [
        testGroupDetail({
          source_test_cases: [groupSourceCase(4, "TC-001", "录制检查")],
          automation_test_cases: [
            groupAutomationCase(1, "AUTO-000001", { title: "自动回放" }),
          ],
        }),
      ],
    }),
  );
  await openGroupsView();
  fireEvent.click(await screen.findByRole("button", { name: "编辑设置" }));
  await screen.findByRole("button", { name: "执行自动化测试" });

  const sourceRow = screen.getByText("TC-001").closest("tr") as HTMLElement;
  expect(sourceRow).toHaveTextContent("人工");
  const automationRow = screen
    .getByText("AUTO-000001")
    .closest("tr") as HTMLElement;
  expect(automationRow).toHaveTextContent("自动化");

  fireEvent.click(within(automationRow).getByRole("button", { name: "移除" }));
  // 移除也要先弹窗确认
  fireEvent.click(await screen.findByRole("button", { name: "确认移除" }));

  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          String(input).endsWith("/test-groups/21/automation-test-cases/1") &&
          init?.method === "DELETE",
      ),
    ).toBe(true),
  );
  expect(await screen.findByText("已从测试组移除。")).toBeVisible();
});

test("数据包可以在表内逐条选择，也可以批量分配", async () => {
  const fetchMock = stubGroupsApi(
    detailState({
      groups: [
        testGroupDetail({
          automation_test_cases: [
            groupAutomationCase(1, "AUTO-000001", { title: "自动回放" }),
          ],
        }),
      ],
    }),
  );
  await openGroupsView();
  fireEvent.click(await screen.findByRole("button", { name: "编辑设置" }));
  await screen.findByRole("button", { name: "执行自动化测试" });

  const packageSelect = screen.getByLabelText("AUTO-000001 数据包");
  await within(packageSelect).findByRole("option", { name: "DP-000008" });
  fireEvent.change(packageSelect, { target: { value: "8" } });
  expect(await screen.findByText("数据包已更新。")).toBeVisible();

  expect(
    callsOf(fetchMock).some(
      ([input, init]) =>
        String(input).endsWith(
          "/test-groups/21/automation-test-cases/1/data-packages",
        ) &&
        init?.method === "PUT" &&
        JSON.parse(String(init.body)).data_package_ids[0] === 8,
    ),
  ).toBe(true);

  fireEvent.change(screen.getByLabelText("批量数据包"), {
    target: { value: "7" },
  });
  fireEvent.click(screen.getByRole("button", { name: "分配给全部自动化用例" }));
  expect(
    await screen.findByText("已把数据包分配给全部自动化用例。"),
  ).toBeVisible();
  expect(
    callsOf(fetchMock).some(
      ([input, init]) =>
        String(input).endsWith("/data-package-assignments") &&
        init?.method === "POST",
    ),
  ).toBe(true);
});

test("测试组用例每页只显示 20 条", async () => {
  const manyCases = Array.from({ length: 25 }, (_, index) =>
    groupSourceCase(
      index + 1,
      `TC-${String(index + 1).padStart(3, "0")}`,
      `用例 ${index + 1}`,
    ),
  );
  await openDetailWith(
    detailState({
      groups: [testGroupDetail({ source_test_cases: manyCases })],
    }),
  );

  expect(screen.getByText(/第 1 \/ 2 页/)).toBeVisible();
  expect(screen.getAllByRole("row")).toHaveLength(21);

  fireEvent.click(screen.getByRole("button", { name: "下一页" }));

  expect(await screen.findByText(/第 2 \/ 2 页/)).toBeVisible();
  expect(screen.getAllByRole("row")).toHaveLength(6);
});
