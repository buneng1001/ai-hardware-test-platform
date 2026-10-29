import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { automationCase, sourceCase } from "./test/casesFixtures";
import { dataPackage } from "./test/dataPackagesHarness";
import {
  assignedPackage,
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

const sourceCases = [
  sourceCase({ id: 4, case_number: "SRC-001", title: "录制" }),
  sourceCase({ id: 5, case_number: "SRC-002", title: "断电恢复" }),
];

const automationCases = [
  automationCase({
    id: 1,
    case_number: "AUTO-000001",
    title: "录制检查",
    validation_status: "passed",
  }),
  automationCase({
    id: 2,
    case_number: "AUTO-000002",
    title: "回放检查",
    validation_status: "passed",
  }),
  automationCase({
    id: 3,
    case_number: "AUTO-000003",
    title: "未校验用例",
    validation_status: "unvalidated",
  }),
];

const packages = [
  dataPackage({ id: 7, package_number: "DP-000007" }),
  dataPackage({ id: 8, package_number: "DP-000008" }),
];

function detailState(overrides: Partial<GroupStubState> = {}) {
  return {
    groups: [testGroupDetail({})],
    sourceCases,
    automationCases,
    packages,
    ...overrides,
  } satisfies GroupStubState;
}

async function openDetail(state: GroupStubState) {
  stubGroupsApi(state);
  await openGroupsView();
  fireEvent.click(await screen.findByRole("button", { name: "编辑设置" }));
  await screen.findByText("测试组名称创建后不可修改");
}

async function selectOption(select: HTMLElement, name: RegExp | string) {
  const option = await within(select).findByRole("option", { name });
  (option as HTMLOptionElement).selected = true;
  fireEvent.change(select);
}

test("测试组详情可加入、排序和移除原始用例", async () => {
  const state = detailState({
    groups: [
      testGroupDetail({
        source_test_cases: [groupSourceCase(4, "SRC-001", "录制")],
      }),
    ],
  });
  const fetchMock = stubGroupsApi(state);
  await openGroupsView();
  fireEvent.click(await screen.findByRole("button", { name: "编辑设置" }));
  await screen.findByText("测试组名称创建后不可修改");

  const panel = screen.getByLabelText("测试组原始用例范围");
  const candidateSelect = within(panel).getByLabelText("加入原始用例");
  await selectOption(candidateSelect, /SRC-002/);
  fireEvent.click(
    within(panel).getByRole("button", { name: "加入所选原始用例" }),
  );
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          String(input).endsWith("/test-groups/21/source-test-cases") &&
          init?.method === "POST" &&
          JSON.parse(String(init.body)).case_ids[0] === 5,
      ),
    ).toBe(true),
  );
  expect(await screen.findByText("SRC-002")).toBeVisible();

  fireEvent.click(within(panel).getAllByRole("button", { name: "下移" })[0]);
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          String(input).endsWith("/source-test-cases/order") &&
          init?.method === "PUT",
      ),
    ).toBe(true),
  );

  fireEvent.click(within(panel).getAllByRole("button", { name: "移除" })[0]);
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          /\/source-test-cases\/\d+$/.test(String(input)) &&
          init?.method === "DELETE",
      ),
    ).toBe(true),
  );
});

test("自动化用例只列已校验候选，并支持批量关联和逐条取消数据包", async () => {
  const state = detailState({
    groups: [
      testGroupDetail({
        automation_test_cases: [
          groupAutomationCase(1, "AUTO-000001", {
            title: "录制检查",
            data_packages: [
              assignedPackage(7, "DP-000007", {
                has_newer_source_result: true,
                recommended_source_run_id: 15,
                warnings: [
                  "来源用例软件版本为 EVT0，与当前产品版本 EVT1 不一致，请确认。",
                  "数据包来源任务已有更新结果；当前仍保留已选择的数据包，未自动替换。",
                ],
              }),
              assignedPackage(9, "DP-000009", {
                validation_status: "failed",
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const fetchMock = stubGroupsApi(state);
  await openGroupsView();
  fireEvent.click(await screen.findByRole("button", { name: "编辑设置" }));
  await screen.findByText("测试组名称创建后不可修改");

  expect(
    screen.getByText(
      "来源用例软件版本为 EVT0，与当前产品版本 EVT1 不一致，请确认。",
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      "数据包来源任务已有更新结果；当前仍保留已选择的数据包，未自动替换。",
    ),
  ).toBeVisible();
  expect(screen.getByText("数据包 DP-000009 未校验，不能执行。")).toBeVisible();
  expect(
    callsOf(fetchMock).filter(([, init]) => (init?.method ?? "GET") === "PUT"),
  ).toHaveLength(0);

  const panel = screen.getByLabelText("测试组自动化用例与数据包");
  const candidateSelect = within(panel).getByLabelText("加入已校验自动化用例");
  expect(
    within(candidateSelect).queryByRole("option", { name: /AUTO-000003/ }),
  ).toBeNull();
  await selectOption(candidateSelect, /AUTO-000002/);
  fireEvent.click(within(panel).getByRole("button", { name: "加入所选用例" }));
  await within(panel).findByLabelText("选择 AUTO-000002 用于批量关联");

  fireEvent.change(within(panel).getByLabelText("批量关联数据包"), {
    target: { value: "8" },
  });
  for (const name of [
    "选择 AUTO-000001 用于批量关联",
    "选择 AUTO-000002 用于批量关联",
  ]) {
    fireEvent.click(within(panel).getByLabelText(name));
  }
  fireEvent.click(
    within(panel).getByRole("button", { name: "关联到所选用例" }),
  );
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          String(input).endsWith("/data-package-assignments") &&
          init?.method === "POST",
      ),
    ).toBe(true),
  );

  const packageSelect = within(panel).getByLabelText("AUTO-000001 数据包");
  for (const option of within(packageSelect).getAllByRole("option")) {
    (option as HTMLOptionElement).selected = false;
  }
  fireEvent.change(packageSelect);
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          String(input).endsWith("/automation-test-cases/1/data-packages") &&
          init?.method === "PUT" &&
          JSON.parse(String(init.body)).data_package_ids.length === 0,
      ),
    ).toBe(true),
  );
  const packagePuts = callsOf(fetchMock).filter(
    ([input, init]) =>
      String(input).endsWith("/data-packages") && init?.method === "PUT",
  );
  expect(packagePuts).toHaveLength(1);

  fireEvent.click(within(panel).getAllByRole("button", { name: "下移" })[0]);
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          String(input).endsWith("/automation-test-cases/order") &&
          init?.method === "PUT",
      ),
    ).toBe(true),
  );

  fireEvent.click(within(panel).getAllByRole("button", { name: "移除" })[0]);
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(
        ([input, init]) =>
          /\/automation-test-cases\/\d+$/.test(String(input)) &&
          init?.method === "DELETE",
      ),
    ).toBe(true),
  );
  expect(
    await screen.findByText("已从测试组移除；平台级自动化用例保留。"),
  ).toBeVisible();
});
