import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ProductVersion } from "./projectsApi";
import { V020RequirementsScreen } from "./V020RequirementsScreen";

const version = (id: number, ai_context = ""): ProductVersion => ({
  id, project_id: 1, version: `EVT${id}`, name: "", description: "版本描述",
  ai_context, created_at: "now", updated_at: "now",
});

afterEach(cleanup);

test("说明保存、撤销修改与版本隔离", async () => {
  const onSave = vi.fn(async (id: number, note: string) => ({ ...version(id), ai_context: note }));
  const { rerender } = render(<V020RequirementsScreen key="1" version={version(1, "旧说明")} onOpenSource={() => undefined} onSaveAiContext={onSave} />);
  const note = screen.getByLabelText("本版本 AI 补充说明输入");
  expect(note).toHaveValue("旧说明");
  fireEvent.change(note, { target: { value: "未保存" } });
  fireEvent.click(screen.getByRole("button", { name: "撤销修改" }));
  expect(note).toHaveValue("旧说明");
  fireEvent.change(note, { target: { value: "已保存 A" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(1, "已保存 A"));
  await screen.findByText("已保存当前版本的 AI 补充说明。");
  rerender(<V020RequirementsScreen key="2" version={version(2)} onOpenSource={() => undefined} onSaveAiContext={onSave} />);
  expect(screen.getByLabelText("本版本 AI 补充说明输入")).toHaveValue("");
  rerender(<V020RequirementsScreen key="1" version={version(1, "已保存 A")} onOpenSource={() => undefined} onSaveAiContext={onSave} />);
  expect(screen.getByLabelText("本版本 AI 补充说明输入")).toHaveValue("已保存 A");
});

test("3001 字符阻止保存；多字节字符统一计数；保存失败不丢草稿", async () => {
  const onSave = vi.fn().mockRejectedValue(new Error("网络中断"));
  render(<V020RequirementsScreen version={version(1)} onOpenSource={() => undefined} onSaveAiContext={onSave} />);
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
  render(<V020RequirementsScreen version={null} onOpenSource={onOpenSource} onSaveAiContext={onSave} />);
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "导入用例" }));
  expect(onOpenSource).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});
