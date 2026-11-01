import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { V020RequirementsScreen } from "./V020RequirementsScreen";

afterEach(cleanup);

test("选择需求资料后展示文件名", () => {
  render(<V020RequirementsScreen onOpenSource={() => undefined} />);

  expect(screen.getByText("尚未选择文件。")).toBeVisible();

  const file = new File(["ignored"], "需求点.docx");
  fireEvent.change(screen.getByLabelText("选择需求资料文件"), {
    target: { files: [file] },
  });

  expect(screen.getByText("已选择文件：需求点.docx")).toBeVisible();
});

test("说明输入框可以输入并保留内容", () => {
  render(<V020RequirementsScreen onOpenSource={() => undefined} />);

  const note = screen.getByLabelText("对上传文件的说明");
  fireEvent.change(note, { target: { value: "按模块拆成可测试的需求点" } });

  expect(note).toHaveValue("按模块拆成可测试的需求点");
});

test("点导入用例时进入测试用例表", () => {
  const onOpenSource = vi.fn();
  render(<V020RequirementsScreen onOpenSource={onOpenSource} />);

  fireEvent.click(screen.getByRole("button", { name: "导入用例" }));

  expect(onOpenSource).toHaveBeenCalledTimes(1);
});
