import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "#dashboard");
  vi.unstubAllGlobals();
});

test("测试工程师能在状态页看到后端和数据库可用", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", database: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]))),
  );
  render(<App />);
  expect(await screen.findByText("服务运行正常")).toBeInTheDocument();
  expect(screen.getByText("SQLite 可用")).toBeInTheDocument();
});

test("测试工程师能刷新仪表盘并进入近期失败运行", async () => {
  const failedRun = {
    id: 9,
    collection_task_id: 3,
    status: "completed",
    configuration_snapshot: {
      mode: "quick",
      scenario: "video_drop",
      duration_seconds: 2,
      video: {
        channels: 1,
        resolution: "640x360",
        fps: 15,
        container: "mp4",
        codec: "h264",
      },
      imu: { format: "csv", sample_rate_hz: 50 },
      random_seed: 20260822,
      reference_channel: "camera_1",
      evaluation: {
        mode: "requirements_acceptance",
        threshold_source: "formal_specification",
        thresholds: { max_failed_checks: 0 },
        priority: [
          "formal_specification",
          "engineering_target",
          "version_baseline",
        ],
      },
    },
    events: [],
    artifacts: [],
    checks: [],
    manual_check_results: [],
    created_at: "2026-08-22T12:00:00Z",
    completed_at: "2026-08-22T12:00:01Z",
    error: null,
  };
  const dashboard = {
    generated_at: "2026-08-22T12:00:02Z",
    run_statistics: {
      total: 2,
      completed: 2,
      failed: 0,
      cancelled: 0,
      interrupted: 0,
    },
    recent_failures: [
      {
        run_id: 9,
        scenario: "video_drop",
        status: "completed",
        error: null,
        failed_check_count: 1,
        latest_diagnosis_status: "completed",
      },
    ],
    diagnosis_status_counts: { completed: 1, failed: 0 },
    evaluation_summary: {
      evaluated_runs: 1,
      hit_count: 1,
      missed_count: 0,
      unsupported_speculation_count: 0,
      false_positive_count: 0,
    },
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])))
    .mockResolvedValueOnce(new Response(JSON.stringify(dashboard)))
    .mockResolvedValueOnce(new Response(JSON.stringify(failedRun)));
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "刷新仪表盘" }));
  expect(
    await screen.findByText("运行 2 次 · 已完成 2 次 · 失败 0 次"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /运行 #9 · video_drop/ }));
  expect(
    await screen.findByRole("heading", { name: "运行 #9" }),
  ).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/runs/9");
});

test("测试工程师能创建快速正常采集任务并重新查看", async () => {
  const createdTask = {
    id: 1,
    name: "面试快速正常采集",
    mode: "quick",
    scenario: "normal",
    status: "draft",
    created_at: "2026-08-22T12:00:00Z",
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(createdTask), { status: 201 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
  fireEvent.change(await screen.findByLabelText("任务名称"), {
    target: { value: "面试快速正常采集" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));
  fireEvent.click(screen.getByRole("button", { name: "已保存任务" }));
  expect(
    await screen.findByRole("heading", { name: "面试快速正常采集" }),
  ).toBeInTheDocument();
  expect(screen.getByText("快速 · 正常采集 · 草稿")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/collection-tasks",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "面试快速正常采集",
        mode: "quick",
        scenario: "normal",
        reference_channel: "camera_1",
      }),
    }),
  );
});

test("设置页切换服务商并在连接请求中防止重复提交", async () => {
  let resolveConnection: ((response: Response) => void) | undefined;
  const connection = new Promise<Response>((resolve) => {
    resolveConnection = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])))
    .mockReturnValueOnce(connection);
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.change(
    await screen.findByRole("combobox", { name: "诊断服务商" }),
    {
      target: { value: "deepseek" },
    },
  );
  await waitFor(() => {
    expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue(
      "deepseek-v4-flash",
    );
  });
  const button = screen.getByRole("button", { name: "测试 AI 连接" });
  fireEvent.click(button);

  expect(button).toBeDisabled();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/settings/ai/test",
    expect.objectContaining({
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        api_key: "",
        provider: "deepseek",
      }),
    }),
  );
  resolveConnection?.(
    new Response(
      JSON.stringify({
        ok: true,
        provider: "deepseek",
        model: "deepseek-v4-flash",
        error_kind: null,
        message: "deepseek 连接可用",
      }),
    ),
  );
  await screen.findByText(
    "当前可用｜来源：本地配置（临时 Key 为空时回退）｜deepseek/deepseek-v4-flash：deepseek 连接可用",
  );
  expect(button).not.toBeDisabled();
});

test("页面刷新后能从公开 API 重新显示已保存采集任务", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", database: "ok" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 7,
              name: "已持久化任务",
              mode: "quick",
              scenario: "normal",
              status: "draft",
              created_at: "2026-08-22T12:00:00Z",
            },
          ]),
        ),
      ),
  );
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "已保存任务" }));
  expect(
    await screen.findByRole("heading", { name: "已持久化任务" }),
  ).toBeInTheDocument();
  expect(screen.getByText("快速 · 正常采集 · 草稿")).toBeInTheDocument();
});

test("空白任务名称在前端被拒绝且不会调用保存 API", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])));
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
  await screen.findByText("还没有采集任务。");
  fireEvent.change(screen.getByLabelText("任务名称"), {
    target: { value: "   " },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存采集任务" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请输入任务名称");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("页面提供明确导航、设置顶栏入口和根据导入生成入口", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", database: "ok" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]))),
  );
  render(<App />);
  expect(
    await screen.findByRole("navigation", { name: "主导航" }),
  ).toBeInTheDocument();
  for (const label of [
    "仪表盘与AI配置",
    "新建任务",
    "根据导入生成",
    "已保存任务",
    "运行详情",
  ]) {
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  }
  expect(
    screen.getByRole("heading", { name: "智能硬件测试执行与诊断平台" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "根据导入生成" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "根据导入生成" }));
  expect(
    screen.getByRole("heading", { name: "根据导入生成" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "配置正常采集" }),
  ).not.toBeInTheDocument();
  expect(window.location.hash).toBe("#import");
});

test("可通过 URL hash 直接打开设置页并返回仪表盘", async () => {
  window.history.replaceState({}, "", "#settings");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", database: "ok" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]))),
  );
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "AI 诊断连接" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "根据导入生成" }),
  ).not.toBeInTheDocument();
  window.history.pushState({}, "", "#dashboard");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitFor(() => {
    expect(screen.getByText("本地运行基线")).toBeVisible();
    expect(screen.getByRole("heading", { name: "AI 诊断连接" })).toBeVisible();
  });
});

test("导入页面按上传、校验状态控制四个操作入口", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 1,
          sha256: "a".repeat(64),
          source_filename: "actual.zip",
          first_imported_at: "2026-08-30T00:00:00Z",
          validator_version: "rc2-import-v1",
          status: "uploaded",
          permission_confirmed: true,
          validation: {},
          created_task_id: null,
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 1,
          sha256: "a".repeat(64),
          source_filename: "actual.zip",
          first_imported_at: "2026-08-30T00:00:00Z",
          validator_version: "rc2-import-v1",
          status: "passed",
          permission_confirmed: true,
          validation: {
            status: "passed",
            security: { status: "passed", errors: [] },
            compatibility: { status: "passed", errors: [] },
            errors: [],
            warnings: [],
            manifest: null,
          },
          created_task_id: null,
        }),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "根据导入生成" }));
  const file = new File(["zip"], "actual.zip", { type: "application/zip" });
  fireEvent.change(screen.getByLabelText("实际测试 ZIP"), {
    target: { files: [file] },
  });
  expect(
    screen.getByRole("button", { name: "导入实际测试文件" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "确认具有处理和展示权限" }),
  );
  expect(
    screen.getByRole("button", { name: "导入实际测试文件" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "导入实际测试文件" }));
  expect(await screen.findByText(/请点击“校验导入文件”/)).toBeInTheDocument();
  expect(screen.getByText("测试标签")).toBeInTheDocument();
  expect(
    screen.getByText(/用于标记这批实际数据的来源或用途/),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "转为标准格式" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "校验导入文件" }));
  expect(
    await screen.findByText("导入校验通过，可以加入任务列表"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "加入任务列表" })).toBeDisabled();
});

test("实际测试文件上传失败时展示可读的对象错误信息", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: { message: "该 ZIP 已导入", existing_import_id: 7 },
        }),
        { status: 409 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "根据导入生成" }));
  fireEvent.change(screen.getByLabelText("实际测试 ZIP"), {
    target: {
      files: [new File(["zip"], "actual.zip", { type: "application/zip" })],
    },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "确认具有处理和展示权限" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "导入实际测试文件" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "该 ZIP 已导入（已有导入记录：7）",
  );
  expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
});

test("已保存任务展示筛选、分页以及删除和归档边界", async () => {
  const tasks = [
    {
      id: 3,
      name: "有运行任务",
      mode: "quick",
      scenario: "normal",
      source: "synthetic_generated",
      execution_status: "has_runs",
      archived: false,
      run_count: 1,
      created_at: "2026-08-22T12:00:00Z",
    },
    {
      id: 2,
      name: "未执行任务",
      mode: "quick",
      scenario: "normal",
      source: "imported_actual_data",
      execution_status: "never_executed",
      archived: false,
      run_count: 0,
      created_at: "2026-08-22T12:00:00Z",
    },
  ];
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ items: tasks, page: 1, page_size: 10, total: 2 }),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "已保存任务" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "刷新已保存任务" }),
  );
  expect(await screen.findByText("有运行任务")).toBeInTheDocument();
  expect(
    screen.getByText(
      (content) =>
        content.includes("来源：合成数据") && content.includes("已有运行"),
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "归档任务 有运行任务" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "删除任务 有运行任务" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "删除任务 未执行任务" }),
  ).toBeInTheDocument();
});

test("设置页用会话内临时 Key 测试硅基流动且不持久化", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", database: "ok" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify([])))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          provider: "siliconflow",
          model: "demo-model",
          error_kind: null,
          message: "硅基流动连接可用",
        }),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  await screen.findByRole("heading", { name: "AI 诊断连接" });

  fireEvent.change(screen.getByRole("combobox", { name: "诊断服务商" }), {
    target: { value: "siliconflow" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "模型" }), {
    target: { value: "__custom__" },
  });
  fireEvent.change(screen.getByLabelText("自定义模型名称"), {
    target: { value: "demo-model" },
  });
  fireEvent.change(screen.getByLabelText("临时 API Key"), {
    target: { value: "session-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "测试 AI 连接" }));

  expect(
    await screen.findByText(
      "当前可用｜来源：临时 API Key｜siliconflow/demo-model：硅基流动连接可用",
    ),
  ).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/settings/ai/test",
    expect.objectContaining({
      body: JSON.stringify({ model: "demo-model", api_key: "session-secret" }),
    }),
  );
});

test("测试工程师能执行正常任务并查看运行阶段产物和检查结果", async () => {
  const task = {
    id: 3,
    name: "可执行正常任务",
    mode: "quick",
    scenario: "normal",
    status: "draft",
    created_at: "2026-08-22T12:00:00Z",
  };
  const completedRun = {
    id: 9,
    collection_task_id: 3,
    status: "completed",
    configuration_snapshot: {
      mode: "quick",
      scenario: "normal",
      duration_seconds: 2,
      video: {
        channels: 1,
        resolution: "640x360",
        fps: 15,
        container: "mp4",
        codec: "h264",
      },
      imu: { format: "csv", sample_rate_hz: 50 },
      random_seed: 20260822,
    },
    events: [
      "queued",
      "generating_data",
      "running_checks",
      "summarizing_results",
      "completed",
    ].map((stage) => ({ stage, occurred_at: "2026-08-22T12:00:00Z" })),
    artifacts: [
      {
        kind: "video",
        path: "runs/9/camera_1.mp4",
        source: "actual_generated",
        size_bytes: 1200,
        sha256: "a",
      },
      {
        kind: "imu",
        path: "runs/9/imu.csv",
        source: "actual_generated",
        size_bytes: 800,
        sha256: "b",
      },
    ],
    checks: [
      { name: "video_h264", status: "passed", message: "视频编码为 H.264" },
    ],
    manual_check_results: [],
    created_at: "2026-08-22T12:00:00Z",
    completed_at: "2026-08-22T12:00:01Z",
    error: null,
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", database: "ok" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([task])))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(completedRun), { status: 201 }),
      ),
  );

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "已保存任务" }));
  fireEvent.click(await screen.findByRole("button", { name: "执行任务" }));

  expect(
    await screen.findByRole("heading", { name: "运行 #9" }),
  ).toBeInTheDocument();
  expect(screen.getByText("已完成")).toBeInTheDocument();
  expect(screen.getByText("进度：5/5（100%）")).toBeInTheDocument();
  expect(
    screen.getByText("排队 → 生成数据 → 执行检查 → 汇总结果 → 已完成"),
  ).toBeInTheDocument();
  expect(screen.getByText("camera_1.mp4")).toBeInTheDocument();
  expect(screen.getByText("视频编码为 H.264")).toBeInTheDocument();
});
