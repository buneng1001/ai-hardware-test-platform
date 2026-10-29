import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { V020DataPackagesScreen } from "./V020DataPackagesScreen";
import {
  callsOf,
  dataPackage,
  dataPackageFiles,
  openDataView,
  stubDataApi,
} from "./test/dataPackagesHarness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("测试数据页展示真实数据包、来源属性、指纹和输入源更新提示", async () => {
  const fetchMock = stubDataApi({ items: [dataPackage({})] });
  await openDataView();

  expect(await screen.findByText("DP-000007")).toBeVisible();
  expect(screen.getByText(/· 平台生成/)).toBeVisible();
  expect(screen.getByText(/故障数据：视频掉帧/)).toBeVisible();
  expect(screen.getByText(/指纹 abc123def456/)).toBeVisible();
  expect(
    screen.getByText(
      "输入源已有更新：推荐运行 #15；不会自动替换当前包，旧数据包仍可用于复现。",
    ),
  ).toBeVisible();
  expect(
    callsOf(fetchMock).filter(([, init]) => (init?.method ?? "GET") !== "GET"),
  ).toHaveLength(0);
});

test("测试数据支持来源、属性、故障类型筛选和编号搜索", async () => {
  const fetchMock = stubDataApi({
    items: [
      dataPackage({ id: 7, package_number: "DP-000007" }),
      dataPackage({
        id: 8,
        package_number: "DP-000008",
        data_kind: "normal",
        fault_type: null,
        has_newer_source_result: false,
        recommended_source_run_id: null,
      }),
    ],
  });
  await openDataView();
  expect(await screen.findByText("DP-000007")).toBeVisible();

  fireEvent.change(screen.getByLabelText("搜索数据包"), {
    target: { value: "DP-000008" },
  });
  expect(screen.getByText("DP-000008")).toBeVisible();
  expect(screen.queryByText("DP-000007")).toBeNull();

  fireEvent.change(screen.getByLabelText("搜索数据包"), {
    target: { value: "" },
  });

  const requested = (key: string, value: string) =>
    callsOf(fetchMock).some(([input]) => {
      const url = new URL(String(input), "http://local");
      return (
        url.pathname === "/api/data-packages" &&
        url.searchParams.get(key) === value
      );
    });

  fireEvent.change(screen.getByRole("combobox", { name: "数据来源" }), {
    target: { value: "generated" },
  });
  await waitFor(() => expect(requested("source_type", "generated")).toBe(true));

  fireEvent.change(screen.getByRole("combobox", { name: "数据属性" }), {
    target: { value: "normal" },
  });
  await waitFor(() => expect(requested("data_kind", "normal")).toBe(true));

  fireEvent.change(screen.getByRole("combobox", { name: "数据属性" }), {
    target: { value: "fault" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "故障类型" }), {
    target: { value: "video_drop" },
  });
  await waitFor(() => expect(requested("fault_type", "video_drop")).toBe(true));
});

test("数据包详情展示文件、通道、时间戳、完整性和故障属性", async () => {
  const detail = {
    ...dataPackage({ id: 7 }),
    files: dataPackageFiles(),
  };
  stubDataApi({ items: [dataPackage({ id: 7 })], detail });
  await openDataView();

  fireEvent.click(screen.getByRole("button", { name: "查看数据详情" }));

  const panel = await screen.findByLabelText("DP-000007 数据包详情");
  expect(within(panel).getByText("camera_1、camera_2")).toBeVisible();
  expect(within(panel).getByText("runs/12/imu.csv")).toBeVisible();
  expect(within(panel).getByText(/已检查 3 个文件/)).toBeVisible();
  expect(within(panel).getByText(/故障数据：视频掉帧/)).toBeVisible();
  expect(
    within(panel).getAllByText("1700000000000000000").length,
  ).toBeGreaterThan(0);
  expect(within(panel).getByText("abc123def456789")).toBeVisible();
});

test("删除数据包前展示关联影响并只移除数据包登记", async () => {
  const fetchMock = stubDataApi({
    items: [dataPackage({})],
    impact: {
      data_package_id: 7,
      package_number: "DP-000007",
      association_counts: {
        test_groups: 2,
        automation_test_cases: 3,
        automation_execution_records: 1,
      },
      total_associations: 6,
    },
  });
  await openDataView();

  fireEvent.click(screen.getByRole("button", { name: "删除数据包" }));
  const dialog = await screen.findByRole("dialog", {
    name: "删除数据包影响范围",
  });
  expect(dialog).toHaveTextContent("测试组：2");
  expect(dialog).toHaveTextContent("自动化用例：3");
  expect(dialog).toHaveTextContent("自动化执行记录：1");
  expect(dialog).toHaveTextContent("关联合计：6");

  fireEvent.click(screen.getByRole("button", { name: "确认删除数据包" }));
  expect(
    await screen.findByText(
      "DP-000007 已删除；来源任务和 v0.1.0 运行记录仍保留。",
    ),
  ).toBeVisible();
  expect(
    callsOf(fetchMock).some(
      ([input, init]) =>
        String(input) === "/api/data-packages/7?confirm=true" &&
        init?.method === "DELETE",
    ),
  ).toBe(true);
});

test("没有已登记数据包时展示空状态", async () => {
  stubDataApi({ items: [] });
  await openDataView();

  expect(await screen.findByText("还没有已登记的数据包")).toBeVisible();
});

test("数据包加载失败时展示原因并可以重试", async () => {
  stubDataApi({
    items: [dataPackage({ id: 7, package_number: "DP-000007" })],
    failListTimes: 1,
  });
  await openDataView();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("数据包加载失败：数据包服务暂时不可用");

  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("DP-000007")).toBeVisible();
});

test("可登记已完成数据任务结果并刷新数据包列表", async () => {
  const fetchMock = stubDataApi({
    items: [],
    registerItems: [dataPackage({ id: 9, package_number: "DP-000009" })],
  });
  await openDataView();

  fireEvent.click(
    screen.getByRole("button", { name: "登记已完成数据任务结果" }),
  );

  expect(await screen.findByText("DP-000009")).toBeVisible();
  expect(
    screen.getByText("已登记所有已完成的数据任务结果；原始运行记录未被修改。"),
  ).toBeVisible();
  expect(
    callsOf(fetchMock).some(
      ([input, init]) =>
        String(input) === "/api/data-packages/register-completed-runs" &&
        init?.method === "POST",
    ),
  ).toBe(true);
});

test("现有 v0.1.0 任务入口仍可从测试数据页打开", async () => {
  stubDataApi({ items: [] });
  const onNavigate = vi.fn();
  render(<V020DataPackagesScreen onNavigate={onNavigate} />);

  fireEvent.click(screen.getByRole("button", { name: "生成新的数据包" }));
  fireEvent.click(screen.getByRole("button", { name: "导入数据并校验" }));
  fireEvent.click(screen.getByRole("button", { name: "执行/刷新数据任务" }));

  expect(onNavigate).toHaveBeenNthCalledWith(1, "new-task");
  expect(onNavigate).toHaveBeenNthCalledWith(2, "import");
  expect(onNavigate).toHaveBeenNthCalledWith(3, "saved");
});
