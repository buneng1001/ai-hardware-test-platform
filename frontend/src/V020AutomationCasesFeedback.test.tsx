import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  automationCase,
  openAutomationView,
  stubApi,
} from "./test/sourceCasesHarness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("AI 反馈不可用时明确提示并保留用户输入", async () => {
  stubApi({
    cases: [],
    records: [],
    automationCases: [automationCase({ id: 1 })],
  });
  await openAutomationView();

  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  const feedback = screen.getByLabelText("AUTO-000001 AI 反馈");
  fireEvent.change(feedback, {
    target: { value: "请把步骤改成命令行执行" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交 AI 反馈" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "AI 反馈适配器不可用",
  );
  expect(screen.getByLabelText("AUTO-000001 AI 反馈")).toHaveValue(
    "请把步骤改成命令行执行",
  );
  expect(screen.getByText("AI 反馈不可用（已保留输入）")).toBeVisible();
});

test("只有反馈被适配器接收后才清空输入", async () => {
  stubApi({
    cases: [],
    records: [],
    automationCases: [automationCase({ id: 1 })],
    feedbackAvailable: true,
  });
  await openAutomationView();

  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByLabelText("AUTO-000001 AI 反馈"), {
    target: { value: "按命令行重写步骤" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交 AI 反馈" }));

  expect(await screen.findByText("AI 反馈已提交。")).toBeVisible();
  expect(screen.getByLabelText("AUTO-000001 AI 反馈")).toHaveValue("");
});

test("转换历史展示原始内容、初始转换、用户修改和反馈状态", async () => {
  stubApi({
    cases: [],
    records: [],
    automationCases: [automationCase({ id: 1 })],
    automationHistory: {
      source: {
        case_number: "REC-001",
        title: "录制",
        input: "12V",
        steps: "开始录制",
        expected_result: "文件完整",
      },
      items: [
        {
          id: 1,
          event_type: "initial_conversion",
          snapshot: { title: "录制" },
          created_at: "2026-10-29T10:00:00+00:00",
        },
        {
          id: 2,
          event_type: "edited",
          snapshot: { title: "录制并检查" },
          created_at: "2026-10-29T10:05:00+00:00",
        },
        {
          id: 3,
          event_type: "feedback_unavailable",
          snapshot: { title: "录制并检查" },
          created_at: "2026-10-29T10:06:00+00:00",
        },
      ],
    },
  });
  await openAutomationView();

  fireEvent.click(screen.getByRole("button", { name: "查看历史" }));

  expect(await screen.findByText(/原始用例：REC-001/)).toBeVisible();
  expect(screen.getByText("12V")).toBeVisible();
  expect(screen.getByText("初始规则转换")).toBeVisible();
  expect(screen.getByText("用户修改")).toBeVisible();
  expect(screen.getByText("AI 反馈不可用")).toBeVisible();
});

test("重新生成后立即变为未校验", async () => {
  stubApi({
    cases: [],
    records: [],
    automationCases: [automationCase({ id: 1, validation_status: "passed" })],
  });
  await openAutomationView();
  expect(screen.getByText("已校验")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));

  expect(
    await screen.findByText("已按当前原始用例重新生成，当前用例已变为未校验。"),
  ).toBeVisible();
  expect(screen.getByText("未校验")).toBeVisible();
});
