import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ManualTestResultsPanel } from "./ManualTestResultsPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const page = {
  test_group_id: 4,
  product_version_id: 2,
  cases: [
    {
      id: 11,
      case_number: "SRC-MANUAL",
      title: "外观检查",
      test_type: "manual",
      position: 1,
    },
    {
      id: 12,
      case_number: "SRC-MIXED",
      title: "按键检查",
      test_type: "mixed",
      position: 2,
    },
  ],
  batches: [
    {
      id: 8,
      test_group_id: 4,
      product_version_id: 2,
      batch_number: 1,
      created_at: "2026-10-04T09:00:00Z",
      updated_at: "2026-10-04T09:00:00Z",
      results: [
        {
          id: 21,
          source_test_case_id: 11,
          status: "passed",
          actual_result: "无划痕",
          notes: "自然光检查",
          executed_at: null,
          created_at: "2026-10-04T09:00:00Z",
          updated_at: "2026-10-04T09:00:00Z",
          attachments: [],
        },
      ],
    },
  ],
};

test("独立人工结果页恢复批次并保存当前行", async () => {
  const saved = {
    ...page.batches[0],
    results: [
      ...page.batches[0].results,
      {
        id: 22,
        source_test_case_id: 12,
        status: "blocked",
        actual_result: "夹具未到位",
        notes: null,
        executed_at: null,
        created_at: "2026-10-04T10:00:00Z",
        updated_at: "2026-10-04T10:00:00Z",
        attachments: [],
      },
    ],
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(page)))
    .mockResolvedValueOnce(new Response(JSON.stringify(saved)));
  vi.stubGlobal("fetch", fetchMock);

  render(<ManualTestResultsPanel groupId={4} onBack={() => undefined} />);

  expect(await screen.findByText("SRC-MANUAL · 外观检查")).toBeInTheDocument();
  expect(screen.getByDisplayValue("无划痕")).toBeInTheDocument();
  expect(screen.queryByText("SRC-AUTO")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("SRC-MIXED 状态"), {
    target: { value: "blocked" },
  });
  fireEvent.change(screen.getByLabelText("SRC-MIXED 实际结果"), {
    target: { value: "夹具未到位" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存 SRC-MIXED" }));

  expect(await screen.findByText("夹具未到位")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/manual-test-result-batches/8",
    expect.objectContaining({ method: "PUT" }),
  );
});

test("测试工程师可以开启新的人工结果批次，不覆盖已保存批次", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(page))),
  );

  render(<ManualTestResultsPanel groupId={4} onBack={() => undefined} />);

  await screen.findByText("SRC-MANUAL · 外观检查");
  fireEvent.click(screen.getByRole("button", { name: "新建记录批次" }));

  expect(screen.getByText("已新建未保存的记录批次。")).toBeInTheDocument();
  expect(screen.getByLabelText("记录批次")).toHaveValue("");
});
