import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { RunDetail } from "./RunDetail";
import type { RunRecord } from "./collectionTasksApi";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const run = {
  id: 42,
  collection_task_id: 4,
  status: "completed",
  configuration_snapshot: {
    scenario: "normal",
    random_seed: 20260822,
    video: { channels: 1 },
  },
  events: [],
  artifacts: [],
  checks: [],
  manual_check_results: [],
  alignment_result: null,
  evaluation_result: null,
  generation_metadata: null,
  created_at: "2026-11-22T00:00:00Z",
  completed_at: "2026-11-22T00:01:00Z",
} as unknown as RunRecord;

function view() {
  return render(
    <RunDetail
      run={run}
      onCancel={() => undefined}
      onRerun={() => undefined}
      onReviewAlignment={() => undefined}
      diagnosisMode="deepseek"
      diagnosisProvider="deepseek"
      diagnosisModel="deepseek-flash"
      temporaryApiKey=""
    />,
  );
}

test("returning to a running diagnosis shows scoped activity and local stop without restarting", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url === "/api/runs/42/diagnoses")
        return new Response(JSON.stringify([]), { status: 200 });
      if (url === "/api/settings/ai/active-invocation")
        return new Response(
          JSON.stringify({
            active: {
              invocation_id: "inv42",
              operation_type: "diagnosis",
              resource_id: 42,
              status: "running",
              stopping: false,
            },
          }),
        );
      if (
        url === "/api/settings/ai/invocations/inv42/cancel" &&
        init?.method === "POST"
      )
        return new Response(JSON.stringify({ stopping: true }));
      throw new Error("unexpected " + url);
    }),
  );
  view();
  expect(await screen.findByText("AI 诊断正在运行")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "生成 真实模型 诊断" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "停止当前诊断" }));
  await waitFor(() =>
    expect(requests).toContain("/api/settings/ai/invocations/inv42/cancel"),
  );
  expect(screen.getByRole("button", { name: "停止当前诊断" })).toBeDisabled();
  expect(
    requests.filter((url) => url === "/api/runs/42/diagnoses"),
  ).toHaveLength(1);
});

test("another run's AI call never displays the local stop control", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runs/42/diagnoses")
        return new Response(JSON.stringify([]));
      if (url === "/api/settings/ai/active-invocation")
        return new Response(
          JSON.stringify({
            active: {
              invocation_id: "other",
              operation_type: "diagnosis",
              resource_id: 99,
              status: "running",
              stopping: false,
            },
          }),
        );
      throw new Error(url);
    }),
  );
  view();
  await screen.findByRole("button", { name: "生成 真实模型 诊断" });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "停止当前诊断" }),
    ).not.toBeInTheDocument(),
  );
});
