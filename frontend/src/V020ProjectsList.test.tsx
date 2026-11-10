import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import { defaultProductProfile } from "./projectsApi";
import { v020ProjectImpact } from "./v020ProjectFixtures";

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

test("项目卡片按参考图独立折叠，真实产品特征以标签展示，更多菜单保留删除确认", async () => {
  const firstProject: ProjectSummary = {
    ...v020Project,
    product_profile: {
      ...defaultProductProfile,
      physical_keys: 2,
      cameras: 1,
      platform: "app",
    },
  };
  const secondProject: ProjectSummary = {
    ...v020Project,
    id: 2,
    name: "VR 眼镜 Pro",
    product_name: "眼镜设备",
    description: "第二项目",
    product_version_count: 0,
  };
  vi.stubGlobal(
    "fetch",
    mockProjectApi({
      "GET /api/projects": [firstProject, secondProject],
      "GET /api/projects/1/deletion-impact": v020ProjectImpact,
    }),
  );
  await openProjectList();

  const firstCard = await screen.findByRole("button", {
    name: "打开项目 IRIS 头环",
  });
  const secondCard = screen.getByRole("button", {
    name: "打开项目 VR 眼镜 Pro",
  });
  expect(within(firstCard).getByText("按键 ×2")).toBeVisible();
  expect(within(firstCard).getByText("摄像头 ×1")).toBeVisible();
  expect(within(firstCard).getByText("App 平台")).toBeVisible();
  expect(within(secondCard).queryByText("项目简介")).toBeNull();

  fireEvent.click(within(firstCard).getByRole("button", { name: "收起详情" }));
  expect(within(firstCard).queryByText("按键 ×2")).toBeNull();
  fireEvent.click(within(secondCard).getByRole("button", { name: "查看详情" }));
  expect(within(secondCard).getByText("第二项目")).toBeVisible();
  expect(within(firstCard).queryByText("第二项目")).toBeNull();

  fireEvent.click(within(firstCard).getByLabelText("更多操作：IRIS 头环"));
  fireEvent.click(within(firstCard).getByRole("button", { name: "删除项目" }));
  expect(
    await screen.findByRole("dialog", { name: "删除影响确认" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog", { name: "删除影响确认" })).toBeNull();
  expect(firstCard).toBeVisible();
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
  // 新建成功后要有明确反馈，而不是只在列表顶部悄悄多出一张卡片。
  expect(screen.getByText(/已创建项目「新项目 A」/)).toBeVisible();
  expect(screen.getByRole("button", { name: /新项目 A/ }).className).toContain(
    "prototype-project-card--new",
  );
});

test("搜索后显示当前筛选并可一键清除", async () => {
  vi.stubGlobal(
    "fetch",
    mockProjectApi({ "GET /api/projects": [v020Project] }),
  );
  await openProjectList();

  fireEvent.change(screen.getByLabelText("搜索项目"), {
    target: { value: "头环" },
  });
  expect(screen.getByRole("button", { name: "清空搜索框" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "查找" }));
  expect(await screen.findByLabelText("当前筛选")).toHaveTextContent("头环");

  fireEvent.click(
    screen.getByRole("button", { name: "清除筛选，显示全部项目" }),
  );

  await waitFor(() => expect(screen.queryByLabelText("当前筛选")).toBeNull());
  expect(screen.getByLabelText("搜索项目")).toHaveValue("");
});

test("重新进入项目列表会清空上次的搜索条件", async () => {
  vi.stubGlobal(
    "fetch",
    mockProjectApi({ "GET /api/projects": [v020Project] }),
  );
  await openProjectList();

  fireEvent.change(screen.getByLabelText("搜索项目"), {
    target: { value: "头环" },
  });
  fireEvent.click(screen.getByRole("button", { name: "查找" }));
  await screen.findByLabelText("当前筛选");

  fireEvent.click(screen.getByRole("button", { name: "回到首页" }));
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));

  expect(await screen.findByLabelText("搜索项目")).toHaveValue("");
  await waitFor(() => expect(screen.queryByLabelText("当前筛选")).toBeNull());
});

test("刷新页面后仍然停在项目列表页", async () => {
  vi.stubGlobal(
    "fetch",
    mockProjectApi({ "GET /api/projects": [v020Project] }),
  );
  const first = render(<FrontendRoot />);
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  await screen.findByRole("heading", { name: "项目列表" });
  first.unmount();

  render(<FrontendRoot />);

  expect(
    await screen.findByRole("heading", { name: "项目列表" }),
  ).toBeVisible();
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
