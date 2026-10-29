import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FrontendRoot } from "./FrontendRoot";
import {
  jsonResponse,
  mockProjectApi,
  v020Detail,
  v020EmptyTrend,
  v020Project,
} from "./v020ProjectFixtures";
import type { ProjectDetail, ProjectSummary } from "./projectsApi";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openProjectList() {
  render(<FrontendRoot />);
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  await screen.findByRole("heading", { name: "项目列表" });
}

test("项目列表从接口读取项目并展示产品版本数量", async () => {
  vi.stubGlobal(
    "fetch",
    mockProjectApi({ "GET /api/projects": [v020Project] }),
  );
  await openProjectList();

  expect(
    await screen.findByRole("button", { name: /IRIS 头环/ }),
  ).toBeVisible();
  expect(screen.getByText("1 个产品版本")).toBeVisible();
  expect(screen.getByText(/多传感器记录设备/)).toBeVisible();
});

test("没有项目时展示空状态和新建入口", async () => {
  vi.stubGlobal("fetch", mockProjectApi({ "GET /api/projects": [] }));
  await openProjectList();

  expect(await screen.findByText("还没有项目")).toBeVisible();
  expect(screen.getByRole("button", { name: /新建项目/ })).toBeVisible();
});

test("项目列表加载失败时说明原因并支持重试", async () => {
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.startsWith("/api/projects?")) {
        return jsonResponse({ detail: "未模拟的接口" }, 404);
      }
      attempts += 1;
      if (attempts === 1) throw new Error("网络中断");
      return jsonResponse([v020Project]);
    }),
  );
  await openProjectList();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "项目列表加载失败：网络中断",
  );
  fireEvent.click(screen.getByRole("button", { name: "重试" }));

  expect(
    await screen.findByRole("button", { name: /IRIS 头环/ }),
  ).toBeVisible();
});

test("创建项目后列表中立即出现新项目", async () => {
  const projects: ProjectSummary[] = [];
  const created: ProjectDetail = {
    ...v020Project,
    id: 2,
    name: "新项目 A",
    product_version_count: 0,
    product_versions: [],
  };
  vi.stubGlobal(
    "fetch",
    mockProjectApi({
      "GET /api/projects": () => projects,
      "POST /api/projects": () => {
        const summary: ProjectSummary = {
          id: created.id,
          name: created.name,
          product_name: created.product_name,
          description: created.description,
          product_version_count: 0,
          created_at: created.created_at,
          updated_at: created.updated_at,
        };
        projects.push(summary);
        return created;
      },
    }),
  );
  await openProjectList();

  fireEvent.click(screen.getByRole("button", { name: /新建项目/ }));
  fireEvent.change(screen.getByLabelText("项目名称"), {
    target: { value: "新项目 A" },
  });
  fireEvent.change(screen.getByLabelText("产品名称"), {
    target: { value: "记录设备" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

  expect(await screen.findByRole("button", { name: /新项目 A/ })).toBeVisible();
});

test("搜索和排序条件会传给项目接口", async () => {
  const fetchMock = mockProjectApi({
    "GET /api/projects": [v020Project],
  });
  vi.stubGlobal("fetch", fetchMock);
  await openProjectList();

  fireEvent.change(screen.getByLabelText("搜索项目"), {
    target: { value: "头环" },
  });
  fireEvent.change(screen.getByLabelText("项目排序"), {
    target: { value: "name_asc" },
  });
  fireEvent.click(screen.getByRole("button", { name: "查找" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects?search=%E5%A4%B4%E7%8E%AF&sort=name_asc",
    );
  });
});

test("打开项目时读取项目详情和趋势数据", async () => {
  const fetchMock = mockProjectApi({
    "GET /api/projects": [v020Project],
    "GET /api/projects/1": v020Detail,
    "GET /api/projects/1/trends": v020EmptyTrend,
  });
  vi.stubGlobal("fetch", fetchMock);
  await openProjectList();

  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));

  expect(
    await screen.findByRole("heading", { name: "EVT1 测试工作区" }),
  ).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/1");
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/1/trends");
});
