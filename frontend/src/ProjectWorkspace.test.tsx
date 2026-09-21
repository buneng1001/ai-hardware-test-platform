import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ProjectWorkspace } from "./ProjectWorkspace";
import type { ProjectDetail, ProjectSummary } from "./projectsApi";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "#dashboard");
  vi.unstubAllGlobals();
});

const project: ProjectSummary = {
  id: 1,
  name: "IRIS",
  product_name: "多传感器记录仪",
  description: "Beta 测试项目",
  product_version_count: 0,
  created_at: "2026-09-21T08:00:00Z",
  updated_at: "2026-09-21T08:00:00Z",
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("测试工程师可以创建、搜索和排序项目", async () => {
  const created: ProjectDetail = { ...project, product_versions: [] };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse([]))
    .mockResolvedValueOnce(jsonResponse(created, 201))
    .mockResolvedValueOnce(jsonResponse([project]));
  vi.stubGlobal("fetch", fetchMock);

  render(<ProjectWorkspace />);
  await screen.findByText("还没有项目");
  fireEvent.change(screen.getByLabelText("项目名称"), {
    target: { value: "IRIS" },
  });
  fireEvent.change(screen.getByLabelText("产品名称"), {
    target: { value: "多传感器记录仪" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

  expect(
    await screen.findByRole("heading", { name: "IRIS" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("搜索项目"), {
    target: { value: "记录仪" },
  });
  fireEvent.change(screen.getByLabelText("项目排序"), {
    target: { value: "name_asc" },
  });
  fireEvent.click(screen.getByRole("button", { name: "查找" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/projects?search=%E8%AE%B0%E5%BD%95%E4%BB%AA&sort=name_asc",
    );
  });
});

test("项目详情可以管理不带测试范围的产品版本并显示趋势空状态", async () => {
  const version = {
    id: 11,
    project_id: 1,
    version: "EVT1",
    name: "",
    description: "",
    created_at: "2026-09-21T08:10:00Z",
    updated_at: "2026-09-21T08:10:00Z",
  };
  const editedVersion = { ...version, name: "工程验证一版" };
  const detail: ProjectDetail = { ...project, product_versions: [] };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse([project]))
    .mockResolvedValueOnce(jsonResponse(detail))
    .mockResolvedValueOnce(
      jsonResponse({
        project_id: 1,
        status: "empty",
        message: "暂无趋势数据",
        points: [],
      }),
    )
    .mockResolvedValueOnce(jsonResponse(version, 201))
    .mockResolvedValueOnce(jsonResponse(editedVersion));
  vi.stubGlobal("fetch", fetchMock);

  render(<ProjectWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "打开 IRIS" }));
  expect(await screen.findByText("暂无趋势数据")).toBeInTheDocument();
  expect(window.location.hash).toBe("#projects/1");
  fireEvent.change(screen.getByLabelText("版本号"), {
    target: { value: "EVT1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "新建产品版本" }));

  expect(await screen.findByText("EVT1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑 EVT1" }));
  fireEvent.change(screen.getByLabelText("版本名称 EVT1"), {
    target: { value: "工程验证一版" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存 EVT1" }));

  expect(await screen.findByText("工程验证一版")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "打开 EVT1" }));
  expect(window.location.hash).toBe("#projects/1/versions/11");
  expect(
    screen.getByRole("navigation", { name: "项目工作区导航" }),
  ).toHaveTextContent("IRIS/EVT1");
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/product-versions/11",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ name: "工程验证一版", description: "" }),
    }),
  );
});

test("删除项目前必须展示产品版本和资产影响范围", async () => {
  const impact = {
    project_id: 1,
    product_versions: [{ id: 11, version: "EVT1", name: "工程验证一版" }],
    asset_counts: {
      source_test_cases: 2,
      automation_test_cases: 1,
      data_packages: 0,
      test_groups: 1,
      automation_execution_records: 0,
      manual_test_records: 0,
      online_reports: 0,
    },
    total_affected_assets: 4,
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse([project]))
    .mockResolvedValueOnce(jsonResponse(impact))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);

  render(<ProjectWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "删除 IRIS" }));

  const dialog = await screen.findByRole("dialog", { name: "删除影响范围" });
  expect(dialog).toHaveTextContent("EVT1");
  expect(dialog).toHaveTextContent("原始测试用例：2");
  expect(dialog).toHaveTextContent("测试组：1");
  expect(dialog).toHaveTextContent("受影响资产合计：4");

  fireEvent.click(screen.getByRole("button", { name: "确认删除项目" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "IRIS" }),
    ).not.toBeInTheDocument(),
  );
  expect(fetchMock).toHaveBeenLastCalledWith("/api/projects/1?confirm=true", {
    method: "DELETE",
  });
});

test("删除产品版本前展示该版本的记录和报告影响范围", async () => {
  const version = {
    id: 11,
    project_id: 1,
    version: "EVT1",
    name: "工程验证一版",
    description: "",
    created_at: "2026-09-21T08:10:00Z",
    updated_at: "2026-09-21T08:10:00Z",
  };
  const detail: ProjectDetail = {
    ...project,
    product_version_count: 1,
    product_versions: [version],
  };
  const counts = {
    source_test_cases: 0,
    automation_test_cases: 0,
    data_packages: 0,
    test_groups: 2,
    automation_execution_records: 3,
    manual_test_records: 1,
    online_reports: 1,
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse([{ ...project, product_version_count: 1 }]),
    )
    .mockResolvedValueOnce(jsonResponse(detail))
    .mockResolvedValueOnce(
      jsonResponse({
        project_id: 1,
        status: "empty",
        message: "暂无趋势数据",
        points: [],
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        product_version: { id: 11, version: "EVT1", name: "工程验证一版" },
        asset_counts: counts,
        total_affected_assets: 7,
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);

  render(<ProjectWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "打开 IRIS" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除 EVT1" }));

  const dialog = await screen.findByRole("dialog", { name: "删除影响范围" });
  expect(dialog).toHaveTextContent("自动化执行记录：3");
  expect(dialog).toHaveTextContent("人工测试记录：1");
  expect(dialog).toHaveTextContent("在线报告：1");
  fireEvent.click(screen.getByRole("button", { name: "确认删除产品版本" }));

  await waitFor(() =>
    expect(screen.queryByText("EVT1")).not.toBeInTheDocument(),
  );
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/product-versions/11?confirm=true",
    { method: "DELETE" },
  );
});

test("刷新产品版本地址后可以恢复项目和版本上下文", async () => {
  const version = {
    id: 11,
    project_id: 1,
    version: "EVT1",
    name: "工程验证一版",
    description: "首轮 Beta 验证",
    created_at: "2026-09-21T08:10:00Z",
    updated_at: "2026-09-21T08:10:00Z",
  };
  const detail: ProjectDetail = {
    ...project,
    product_version_count: 1,
    product_versions: [version],
  };
  window.history.replaceState({}, "", "#projects/1/versions/11");
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("/api/projects?"))
        return Promise.resolve(jsonResponse([project]));
      if (url === "/api/projects/1")
        return Promise.resolve(jsonResponse(detail));
      if (url === "/api/projects/1/trends") {
        return Promise.resolve(
          jsonResponse({
            project_id: 1,
            status: "empty",
            message: "暂无趋势数据",
            points: [],
          }),
        );
      }
      return Promise.reject(new Error(`未预期请求：${url}`));
    }),
  );

  render(<ProjectWorkspace />);

  const versionWorkspace = await screen.findByRole("region", {
    name: "产品版本工作区",
  });
  expect(
    within(versionWorkspace).getByText("当前产品版本"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("navigation", { name: "项目工作区导航" }),
  ).toHaveTextContent("IRIS/EVT1");
  expect(
    within(versionWorkspace).getByText("首轮 Beta 验证"),
  ).toBeInTheDocument();
});
