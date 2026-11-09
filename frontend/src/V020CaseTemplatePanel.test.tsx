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

test("切换到上传模板时提示尚未上传且上传按钮禁用", () => {
  render(<V020CaseTemplatePanel />);

  fireEvent.click(screen.getByRole("button", { name: "上传模板" }));

  expect(screen.getByText("当前使用：上传模板")).toBeVisible();
  expect(screen.getByText(/尚未上传模板/)).toBeVisible();
  expect(screen.getByRole("button", { name: "选择模板文件" })).toBeDisabled();
});
