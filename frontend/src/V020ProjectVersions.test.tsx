import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FrontendRoot } from "./FrontendRoot";
import {
  mockProjectApi,
  v020Detail,
  v020EmptyTrend,
  v020Project,
  v020ProjectImpact,
  v020Version,
  v020VersionImpact,
} from "./v020ProjectFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function projectRoutes(extra: Record<string, unknown> = {}) {
  return {
    "GET /api/projects": [v020Project],
    "GET /api/projects/1": v020Detail,
    "GET /api/projects/1/trends": v020EmptyTrend,
    ...extra,
  };
}

async function openWorkspace() {
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));
  await screen.findByRole("heading", { name: "EVT1 测试工作区" });
}

test("版本与趋势页展示项目版本上下文和趋势空状态", async () => {
  vi.stubGlobal("fetch", mockProjectApi(projectRoutes()));
  render(<FrontendRoot />);
  await openWorkspace();

  expect(screen.getByText("项目 / IRIS 头环")).toBeVisible();
  expect(screen.getByText("当前版本")).toBeVisible();
  expect(screen.getByText("尚无最终报告，暂无趋势数据")).toBeVisible();
});

test("新建产品版本只需填写版本号即可打开", async () => {
  const created = {
    ...v020Version,
    id: 12,
    version: "EVT2",
  };
  vi.stubGlobal(
    "fetch",
    mockProjectApi(
      projectRoutes({
        "POST /api/projects/1/product-versions": created,
      }),
    ),
  );
  render(<FrontendRoot />);
  await openWorkspace();

  fireEvent.click(screen.getByRole("button", { name: /新建产品版本/ }));
  fireEvent.change(screen.getByLabelText("产品版本号"), {
    target: { value: "EVT2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建版本" }));

  expect(
    await screen.findByRole("heading", { name: "EVT2 测试工作区" }),
  ).toBeVisible();
});

test("可以编辑产品版本名称和说明", async () => {
  const updated = { ...v020Version, name: "工程验证一版" };
  vi.stubGlobal(
    "fetch",
    mockProjectApi(
      projectRoutes({ "PATCH /api/product-versions/11": updated }),
    ),
  );
  render(<FrontendRoot />);
  await openWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "编辑版本" }));
  fireEvent.change(screen.getByLabelText("版本名称 EVT1"), {
    target: { value: "工程验证一版" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存版本" }));

  expect(await screen.findByText("EVT1 · 工程验证一版")).toBeVisible();
  expect(
    await screen.findByRole("heading", {
      name: "EVT1 工程验证一版 测试工作区",
    }),
  ).toBeVisible();
});

test("删除产品版本前展示影响范围并在确认后移除", async () => {
  vi.stubGlobal(
    "fetch",
    mockProjectApi(
      projectRoutes({
        "GET /api/product-versions/11/deletion-impact": v020VersionImpact,
        "DELETE /api/product-versions/11": new Response(null, {
          status: 204,
        }),
      }),
    ),
  );
  render(<FrontendRoot />);
  await openWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "删除版本" }));

  const dialog = await screen.findByRole("dialog", { name: "删除影响确认" });
  expect(dialog).toHaveTextContent("涉及 1 个产品版本：EVT1");
  expect(dialog).toHaveTextContent("共影响 5 项资产");
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

  expect(await screen.findByText("还没有产品版本")).toBeVisible();
});

test("删除项目前展示版本与资产影响范围", async () => {
  vi.stubGlobal(
    "fetch",
    mockProjectApi(
      projectRoutes({
        "GET /api/projects/1/deletion-impact": v020ProjectImpact,
      }),
    ),
  );
  render(<FrontendRoot />);
  await openWorkspace();

  fireEvent.click(screen.getByRole("button", { name: "删除项目" }));

  const dialog = await screen.findByRole("dialog", { name: "删除影响确认" });
  expect(dialog).toHaveTextContent("涉及 1 个产品版本：EVT1");
  expect(dialog).toHaveTextContent("共影响 7 项资产");
});
