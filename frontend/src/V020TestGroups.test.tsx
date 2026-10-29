import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { sourceCase } from "./test/casesFixtures";
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

const sourceCases = [
  sourceCase({ id: 4, case_number: "SRC-001", title: "录制" }),
  sourceCase({
    id: 5,
    case_number: "SRC-002",
    title: "断电恢复",
    software_version: "EVT0",
  }),
];

function baseState(overrides: Partial<GroupStubState> = {}): GroupStubState {
  return {
    groups: [
      testGroupDetail({
        source_test_cases: [groupSourceCase(4, "SRC-001", "录制")],
        automation_test_cases: [
          groupAutomationCase(1, "AUTO-000001", { title: "录制检查" }),
        ],
      }),
    ],
    sourceCases,
    automationCases: [],
    packages: [dataPackage({ id: 7, package_number: "DP-000007" })],
    ...overrides,
  };
}

test("测试组列表展示真实数量并支持搜索、排序和隐藏筛选", async () => {
  const groups = Array.from({ length: 25 }, (_, index) =>
    testGroupDetail({
      id: 21 + index,
      name: `测试组 ${String(index + 1).padStart(2, "0")}`,
      hidden: index === 0,
    }),
  );
  const fetchMock = stubGroupsApi(baseState({ groups }));
  await openGroupsView();
  expect(await screen.findByText("测试组 02")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(([input]) => {
        const url = new URL(String(input), "http://local");
        return url.searchParams.get("page") === "2";
      }),
    ).toBe(true),
  );
  expect(screen.getByText(/第 2 页/)).toBeVisible();

  fireEvent.change(screen.getByLabelText("搜索测试组"), {
    target: { value: "测试组 2" },
  });
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(([input]) => {
        const url = new URL(String(input), "http://local");
        return url.searchParams.get("search") === "测试组 2";
      }),
    ).toBe(true),
  );

  fireEvent.change(screen.getByRole("combobox", { name: "测试组排序" }), {
    target: { value: "name_asc" },
  });
  await waitFor(() =>
    expect(
      callsOf(fetchMock).some(([input]) => {
        const url = new URL(String(input), "http://local");
        return url.searchParams.get("sort") === "name_asc";
      }),
    ).toBe(true),
  );

  fireEvent.click(screen.getByRole("checkbox", { name: "显示已隐藏测试组" }));
  await waitFor(() => {
    const calls = callsOf(fetchMock).filter(([input]) =>
      String(input).includes("/test-groups?"),
    );
    const latest = new URL(
      String(calls[calls.length - 1]?.[0]),
      "http://local",
    );
    expect(latest.searchParams.get("hidden")).toBeNull();
  });
});

test("创建测试组时可带入当前待加入的原始用例并进入详情", async () => {
  const fetchMock = stubGroupsApi(
    baseState({ groups: [], selectedSourceIds: [5] }),
  );
  await openGroupsView();

  fireEvent.click(screen.getByRole("button", { name: "＋ 新建测试组" }));
  fireEvent.change(screen.getByLabelText("测试组名称"), {
    target: { value: "EVT1 故障专项" },
  });
  fireEvent.change(screen.getByLabelText("测试组说明"), {
    target: { value: "只验证断电恢复" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建测试组" }));

  expect(await screen.findByText("EVT1 故障专项")).toBeVisible();
  expect(screen.getByText("断电恢复")).toBeVisible();
  expect(screen.getByText("测试组名称创建后不可修改")).toBeVisible();
  const posted = callsOf(fetchMock).find(
    ([input, init]) =>
      String(input) === "/api/product-versions/11/test-groups" &&
      init?.method === "POST",
  );
  const body = JSON.parse(String(posted?.[1]?.body)) as {
    include_selected_source_cases: boolean;
  };
  expect(body.include_selected_source_cases).toBe(true);
});

test("测试组支持隐藏、恢复显示和确认影响后删除", async () => {
  stubGroupsApi(baseState());
  await openGroupsView();
  await screen.findByText("EVT1 基础回归");
  fireEvent.click(screen.getByRole("button", { name: "编辑设置" }));
  expect(await screen.findByText("测试组名称创建后不可修改")).toBeVisible();

  fireEvent.change(screen.getByLabelText("测试组说明"), {
    target: { value: "更新后的说明" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存说明" }));
  expect(await screen.findByText("测试组说明已保存。")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "隐藏" }));
  expect(await screen.findByText("已隐藏")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "恢复显示" }));
  await waitFor(() => expect(screen.getByText("显示中")).toBeVisible());

  fireEvent.click(screen.getByRole("button", { name: "删除测试组" }));
  const dialog = await screen.findByRole("dialog", {
    name: "删除测试组影响范围",
  });
  expect(dialog).toHaveTextContent("原始用例：1");
  expect(dialog).toHaveTextContent("自动化用例：1");
  fireEvent.click(screen.getByRole("button", { name: "确认删除测试组" }));

  expect(
    await screen.findByText("EVT1 基础回归 已删除；平台级用例和数据包保留。"),
  ).toBeVisible();
  expect(await screen.findByText("尚无符合条件的测试组")).toBeVisible();
});

test("没有测试组时展示空状态", async () => {
  stubGroupsApi(baseState({ groups: [] }));
  await openGroupsView();

  expect(await screen.findByText("尚无符合条件的测试组")).toBeVisible();
});

test("测试组加载失败时展示原因并可以重试", async () => {
  stubGroupsApi(baseState({ failListTimes: 1 }));
  await openGroupsView();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("测试组加载失败：测试组服务暂时不可用");

  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("EVT1 基础回归")).toBeVisible();
});
