import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ProductVersion } from "./projectsApi";
import { V020RequirementsScreen } from "./V020RequirementsScreen";

const version = (id: number, ai_context = ""): ProductVersion => ({
  id,
  project_id: 1,
  version: `EVT${id}`,
  name: "",
  description: "版本描述",
  ai_context,
  created_at: "now",
  updated_at: "now",
});

afterEach(cleanup);

test("需求与风险占位只提示开发中，无文件选择、AI 请求或审核发布入口", () => {
  const onOpenSource = vi.fn();
  const onSave = vi.fn();
  const requestSpy = vi.spyOn(globalThis, "fetch");
  try {
    render(
      <V020RequirementsScreen
        version={version(1, "已保存说明")}
        onOpenSource={onOpenSource}
        onSaveAiContext={onSave}
      />,
    );
    expect(screen.queryByLabelText("选择需求资料文件")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(
      screen.queryByText("使用 AI 大模型解析上传文件"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "审核推荐用例" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /发布推荐用例/ }),
    ).not.toBeInTheDocument();
    for (const label of [
      "导入需求点",
      "AI 分析",
      "智能测试用例推荐",
      "AI 风险分析与审核",
    ]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(screen.getByText("该功能开发中")).toBeVisible();
      expect(screen.getByLabelText("本版本 AI 补充说明输入")).toHaveValue(
        "已保存说明",
      );
      fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
      expect(screen.queryByText("该功能开发中")).not.toBeInTheDocument();
    }
    expect(requestSpy).not.toHaveBeenCalled();
    expect(onOpenSource).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "导入用例" }));
    expect(onOpenSource).toHaveBeenCalledOnce();
  } finally {
    requestSpy.mockRestore();
  }
});

test("说明保存、撤销修改与版本隔离", async () => {
  const onSave = vi.fn(async (id: number, note: string) => ({
    ...version(id),
    ai_context: note,
  }));
  const { rerender } = render(
    <V020RequirementsScreen
      key="1"
      version={version(1, "旧说明")}
      onOpenSource={() => undefined}
      onSaveAiContext={onSave}
    />,
  );
  const note = screen.getByLabelText("本版本 AI 补充说明输入");
  expect(note).toHaveValue("旧说明");
  fireEvent.change(note, { target: { value: "未保存" } });
  fireEvent.click(screen.getByRole("button", { name: "撤销修改" }));
  expect(note).toHaveValue("旧说明");
  fireEvent.change(note, { target: { value: "已保存 A" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(1, "已保存 A"));
  await screen.findByText("已保存当前版本的 AI 补充说明。");
  rerender(
    <V020RequirementsScreen
      key="2"
      version={version(2)}
      onOpenSource={() => undefined}
      onSaveAiContext={onSave}
    />,
  );
  expect(screen.getByLabelText("本版本 AI 补充说明输入")).toHaveValue("");
  rerender(
    <V020RequirementsScreen
      key="1"
      version={version(1, "已保存 A")}
      onOpenSource={() => undefined}
      onSaveAiContext={onSave}
    />,
  );
  expect(screen.getByLabelText("本版本 AI 补充说明输入")).toHaveValue(
    "已保存 A",
  );
});

test("3001 字符阻止保存；多字节字符统一计数；保存失败不丢草稿", async () => {
  const onSave = vi.fn().mockRejectedValue(new Error("网络中断"));
  render(
    <V020RequirementsScreen
      version={version(1)}
      onOpenSource={() => undefined}
      onSaveAiContext={onSave}
    />,
  );
  const note = screen.getByLabelText("本版本 AI 补充说明输入");
  fireEvent.change(note, { target: { value: "测".repeat(3001) } });
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(screen.getByText(/超过限制/)).toBeVisible();
  fireEvent.change(note, { target: { value: "😀".repeat(3000) } });
  expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("保存失败：网络中断");
  expect(note).toHaveValue("😀".repeat(3000));
});

test("没有版本不能保存，导入用例保留原入口", () => {
  const onOpenSource = vi.fn();
  const onSave = vi.fn();
  render(
    <V020RequirementsScreen
      version={null}
      onOpenSource={onOpenSource}
      onSaveAiContext={onSave}
    />,
  );
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "导入用例" }));
  expect(onOpenSource).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});
