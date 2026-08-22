import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ManualCheckResultsPanel } from "./ManualCheckResultsPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("测试工程师能新增并修改人工检查结果", async () => {
  const created = {
    id: 4,
    run_id: 9,
    name: "按键响应",
    status: "passed",
    actual_result: "响应正常",
    notes: null,
    executed_at: "2026-08-22T08:00:00Z",
    attachment: null,
    created_at: "2026-08-22T08:00:00Z",
    updated_at: "2026-08-22T08:00:00Z",
  };
  const updated = {
    ...created,
    status: "failed",
    actual_result: "第三次按压无响应",
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify(created), { status: 201 }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(updated)));
  vi.stubGlobal("fetch", fetchMock);

  render(<ManualCheckResultsPanel runId={9} initialResults={[]} />);
  fireEvent.change(screen.getByLabelText("检查项名称"), {
    target: { value: "按键响应" },
  });
  fireEvent.change(screen.getByLabelText("实际结果"), {
    target: { value: "响应正常" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存人工结果" }));

  expect(await screen.findByText("通过 · 响应正常")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "修改按键响应" }));
  fireEvent.change(screen.getByLabelText("状态"), {
    target: { value: "failed" },
  });
  fireEvent.change(screen.getByLabelText("实际结果"), {
    target: { value: "第三次按压无响应" },
  });
  fireEvent.click(screen.getByRole("button", { name: "更新人工结果" }));

  expect(
    await screen.findByText("失败 · 第三次按压无响应"),
  ).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/runs/9/manual-check-results/4",
    expect.objectContaining({ method: "PUT" }),
  );
});

test("导入错误会显示可定位的行号且保留现有人工结果", async () => {
  const existing = {
    id: 2,
    run_id: 9,
    name: "外观检查",
    status: "passed" as const,
    actual_result: "正常",
    notes: null,
    executed_at: null,
    attachment: null,
    created_at: "2026-08-22T08:00:00Z",
    updated_at: "2026-08-22T08:00:00Z",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: [
            {
              row: 3,
              field: "status",
              message: "状态必须是 passed、failed、blocked 或 not_run",
            },
          ],
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );

  render(<ManualCheckResultsPanel runId={9} initialResults={[existing]} />);
  const file = new File(["name,status\n按键,unknown"], "manual-results.csv", {
    type: "text/csv",
  });
  fireEvent.change(screen.getByLabelText("导入 CSV 或 Excel"), {
    target: { files: [file] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "第 3 行 status：状态必须是 passed、failed、blocked 或 not_run",
  );
  expect(screen.getByText("通过 · 正常")).toBeInTheDocument();
});
