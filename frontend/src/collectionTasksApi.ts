export type CollectionTask = {
  id: number;
  name: string;
  mode: DataMode;
  scenario: "normal";
  duration_seconds: number;
  video: VideoConfiguration;
  imu: ImuConfiguration;
  random_seed: number;
  status: "draft";
  created_at: string;
};

export type DataMode = "quick" | "standard" | "custom";
export type VideoConfiguration = {
  channels: number;
  resolution: "640x360" | "1280x720" | "1920x1080";
  fps: 15 | 24 | 25 | 30 | 60;
  container: "mp4" | "mkv";
  codec?: "h264";
};
export type ImuConfiguration = {
  format: "csv" | "jsonl";
  sample_rate_hz: 50 | 100 | 200 | 500;
};
export type CollectionTaskCommand = {
  name: string;
  mode: DataMode;
  scenario: "normal";
  duration_seconds?: number;
  video?: VideoConfiguration;
  imu?: ImuConfiguration;
  random_seed?: number;
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
    mode: DataMode;
    scenario: "normal";
    duration_seconds: number;
    video: VideoConfiguration;
    imu: ImuConfiguration;
    random_seed: number;
  };
  events: Array<{ stage: RunStage; occurred_at: string }>;
  artifacts: Array<{
    kind: string;
    path: string;
    source: "actual_generated" | "virtual_time_simulated";
    size_bytes: number;
    sha256: string;
  }>;
  generation_metadata: {
    timeline_source: "actual_generated" | "virtual_time_simulated";
    requested_duration_seconds: number;
    generated_duration_seconds: number;
    reproducibility_fingerprint: string;
  } | null;
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

export async function createCollectionTask(
  command: CollectionTaskCommand,
): Promise<CollectionTask> {
  const response = await fetch("/api/collection-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
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
