import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { V020CaseTemplatePanel } from "./V020CaseTemplatePanel";

afterEach(cleanup);

test("默认模板只显示简洁的来源选择，不展开全部字段", () => {
  render(<V020CaseTemplatePanel />);

  expect(screen.getByText("用例模板：")).toBeVisible();
  expect(screen.getByRole("button", { name: "默认模板" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByText("使用系统默认模板，无需上传")).toBeVisible();
  expect(screen.queryByLabelText("默认模板列")).toBeNull();
  expect(screen.getByRole("button", { name: "选择文件" })).toBeDisabled();
});

test("上传模板支持本地选文件但明确说明解析未接入", () => {
  render(<V020CaseTemplatePanel />);

  fireEvent.click(screen.getByRole("button", { name: "上传模板" }));

  expect(screen.getByRole("button", { name: "上传模板" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByText(/请选择 CSV \/ Excel 文件/)).toBeVisible();
  expect(screen.getByRole("button", { name: "选择文件" })).toBeEnabled();
  const file = new File(["header"], "my-template.xlsx", {
    type: "application/octet-stream",
  });
  fireEvent.change(screen.getByLabelText("选择测试用例模板文件"), {
    target: { files: [file] },
  });
  expect(screen.getByText(/已选择：my-template.xlsx/)).toBeVisible();
  expect(screen.getByText(/解析暂未接入/)).toBeVisible();
});
