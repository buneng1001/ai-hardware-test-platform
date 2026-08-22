export type CollectionTask = {
  id: number;
  name: string;
  mode: "quick";
  scenario: "normal";
  status: "draft";
  created_at: string;
};

type RunStage =
  | "queued"
  | "generating_data"
  | "running_checks"
  | "summarizing_results"
  | "completed";

export type RunRecord = {
  id: number;
  collection_task_id: number;
  status: "completed" | "failed";
  configuration_snapshot: {
    mode: "quick";
    scenario: "normal";
    duration_seconds: 2;
    video: {
      channels: 1;
      resolution: "640x360";
      fps: 15;
      container: "mp4";
      codec: "h264";
    };
    imu: { format: "csv"; sample_rate_hz: 50 };
    random_seed: 20260822;
  };
  events: Array<{ stage: RunStage; occurred_at: string }>;
  artifacts: Array<{
    kind: string;
    path: string;
    source: "actual_generated";
    size_bytes: number;
    sha256: string;
  }>;
  checks: Array<{ name: string; status: "passed" | "failed"; message: string }>;
  created_at: string;
  completed_at: string | null;
  error: string | null;
};

export async function listCollectionTasks(): Promise<CollectionTask[]> {
  const response = await fetch("/api/collection-tasks");
  if (!response.ok) {
    throw new Error("采集任务列表加载失败");
  }
  return (await response.json()) as CollectionTask[];
}

export async function createQuickNormalTask(
  name: string,
): Promise<CollectionTask> {
  const response = await fetch("/api/collection-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mode: "quick", scenario: "normal" }),
  });
  if (!response.ok) {
    throw new Error("采集任务保存失败，请检查输入后重试");
  }
  return (await response.json()) as CollectionTask;
}

export async function executeCollectionTask(
  taskId: number,
): Promise<RunRecord> {
  const response = await fetch(`/api/collection-tasks/${taskId}/runs`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("采集任务执行失败");
  }
  return (await response.json()) as RunRecord;
}
