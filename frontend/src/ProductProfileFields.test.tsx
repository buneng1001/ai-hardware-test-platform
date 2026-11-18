import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { V020ProjectsScreen } from "./V020ProjectsScreen";
import { defaultProductProfile } from "./projectsApi";
import { appendInterface, ProductProfileFields } from "./ProductProfileFields";
import type { V020ProjectWorkspace } from "./useV020ProjectWorkspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("接口标签保留自由文本、去重并遵守 300 字符边界", () => {
  expect(appendInterface("自定义、USB-A", "Wi-Fi")).toBe(
    "自定义、USB-A、Wi-Fi",
  );
  expect(appendInterface("自定义、USB-A", "USB-A")).toBe("自定义、USB-A");
  expect(appendInterface("x".repeat(299), "Wi-Fi")).toHaveLength(299);
});

test("新建和编辑共用画像字段，接口快捷标签可选可删除", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <ProductProfileFields
      profile={defaultProductProfile}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "通信接口" }), {
    target: { value: "自定义接口" },
  });
  expect(onChange).toHaveBeenLastCalledWith({
    ...defaultProductProfile,
    interfaces: "自定义接口",
  });
  rerender(
    <ProductProfileFields
      profile={{ ...defaultProductProfile, interfaces: "自定义接口" }}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByText("常用接口"));
  fireEvent.click(screen.getByRole("button", { name: "USB-A" }));
  expect(onChange).toHaveBeenLastCalledWith({
    ...defaultProductProfile,
    interfaces: "自定义接口、USB-A",
  });
  expect(screen.getByRole("textbox", { name: "通信接口" })).toHaveAttribute(
    "maxLength",
    "300",
  );
});

function workspace(profile: typeof defaultProductProfile | null = null) {
  const project = {
    id: 7,
    name: "测试项目",
    product_name: "设备",
    description: "",
    product_version_count: 0,
    product_profile: profile,
    created_at: "",
    updated_at: "",
  };
  return {
    projects: [project],
    projectsLoading: false,
    projectsError: null,
    search: "",
    appliedSearch: "",
    sort: "updated_desc",
    createdProject: null,
    actionError: null,
    busy: false,
    refreshProjects: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
    clearSearch: vi.fn(),
    clearCreatedProject: vi.fn(),
    submitProject: vi.fn(),
    previewProjectDeletion: vi.fn(),
    saveProductProfile: vi.fn().mockResolvedValue(undefined),
    pendingDeletion: null,
    cancelDeletion: vi.fn(),
  } as unknown as V020ProjectWorkspace;
}

test("从更多菜单编辑 null 画像，取消不发请求；保存才调用指定项目 API", async () => {
  const state = workspace();
  render(
    <V020ProjectsScreen workspace={state} onOpen={vi.fn()} onBack={vi.fn()} />,
  );
  fireEvent.click(screen.getByLabelText("更多操作：测试项目"));
  fireEvent.click(screen.getByRole("button", { name: "编辑产品画像" }));
  expect(
    screen.getByRole("form", { name: "编辑产品画像" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(state.saveProductProfile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "编辑产品画像" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "实体按键数量" }), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(state.saveProductProfile).toHaveBeenCalledWith(7, {
      ...defaultProductProfile,
      physical_keys: 3,
    }),
  );
});

test("保存失败时保留草稿与错误，不伪装成功", async () => {
  const state = workspace();
  vi.mocked(state.saveProductProfile).mockRejectedValue(
    new Error("模拟写入失败"),
  );
  render(
    <V020ProjectsScreen workspace={state} onOpen={vi.fn()} onBack={vi.fn()} />,
  );
  fireEvent.click(screen.getByLabelText("更多操作：测试项目"));
  fireEvent.click(screen.getByRole("button", { name: "编辑产品画像" }));
  fireEvent.change(screen.getByRole("textbox", { name: "通信接口" }), {
    target: { value: "专用接口" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("模拟写入失败");
  expect(screen.getByRole("textbox", { name: "通信接口" })).toHaveValue(
    "专用接口",
  );
});
