import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { V020CaseTemplatePanel } from "./V020CaseTemplatePanel";

afterEach(cleanup);

test("默认模板展示产品确认过的 12 列", () => {
  render(<V020CaseTemplatePanel />);

  expect(screen.getByText("当前使用：默认模板")).toBeVisible();

  const columns = screen.getByLabelText("默认模板列");
  expect(columns.children).toHaveLength(12);
  expect(columns).toHaveTextContent("用例编号");
  expect(columns).toHaveTextContent("预置条件");
  expect(columns).toHaveTextContent("附件");
  expect(columns).toHaveTextContent("软件版本");
  // 确认已删减的四个字段不再出现在默认模板里。
  expect(columns).not.toHaveTextContent("测试结果");
  expect(columns).not.toHaveTextContent("计划执行时间");
});

test("上传模板支持本地选文件但明确说明解析未接入", () => {
  render(<V020CaseTemplatePanel />);

  fireEvent.click(screen.getByRole("button", { name: "上传模板" }));

  expect(screen.getByText("当前使用：上传模板")).toBeVisible();
  expect(screen.getByText(/尚未选择文件/)).toBeVisible();
  expect(screen.getByRole("button", { name: "选择模板文件" })).toBeEnabled();
  const file = new File(["header"], "my-template.xlsx", {
    type: "application/octet-stream",
  });
  fireEvent.change(screen.getByLabelText("选择测试用例模板文件"), {
    target: { files: [file] },
  });
  expect(screen.getByText(/已选择：my-template.xlsx/)).toBeVisible();
  expect(screen.getByText(/模板解析和保存暂未接入/)).toBeVisible();
});
