import type { ManualCheckResult } from "./manualCheckResultsApi";

export type CollectionTask = {
  id: number;
  name: string;
  mode: DataMode;
  scenario: Scenario;
  duration_seconds: number;
  video: VideoConfiguration;
  imu: ImuConfiguration;
  random_seed: number;
  reference_channel: ReferenceChannel;
  evaluation: EvaluationConfiguration;
  status: "draft";
  created_at: string;
};

export type DataMode = "quick" | "standard" | "custom";
export type Scenario =
  | "normal"
  | "video_drop"
  | "imu_anomaly"
  | "storage_exhaustion"
  | "fixed_offset"
  | "linear_drift";
export type ReferenceChannel =
  "camera_1" | "camera_2" | "camera_3" | "camera_4" | "imu";
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
  scenario: Scenario;
  duration_seconds?: number;
  video?: VideoConfiguration;
  imu?: ImuConfiguration;
  random_seed?: number;
  reference_channel?: ReferenceChannel;
  evaluation?: EvaluationConfiguration;
};
export type EvaluationMode =
  "requirements_acceptance" | "engineering_target" | "baseline_analysis";
export type ThresholdSource =
  "formal_specification" | "engineering_target" | "version_baseline";
export type EvaluationConfiguration = {
  mode: EvaluationMode;
  threshold_source: ThresholdSource;
  thresholds: { max_failed_checks?: number };
  priority: ThresholdSource[];
};

export type RunStatus =
  | "queued"
  | "generating_data"
  | "running_checks"
  | "summarizing_results"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type RunRecord = {
  id: number;
  collection_task_id: number;
  status: RunStatus;
  configuration_snapshot: {
    mode: DataMode;
    scenario: Scenario;
    duration_seconds: number;
    video: VideoConfiguration;
    imu: ImuConfiguration;
    random_seed: number;
    reference_channel: ReferenceChannel;
    evaluation: EvaluationConfiguration;
  };
  events: Array<{ stage: RunStatus; occurred_at: string }>;
  artifacts: Array<{
    kind: string;
    path: string;
    source: "actual_generated" | "virtual_time_simulated";
    size_bytes: number;
    sha256: string;
    codec: "h264" | null;
  }>;
  generation_metadata: {
    timeline_source: "actual_generated" | "virtual_time_simulated";
    requested_duration_seconds: number;
    generated_duration_seconds: number;
    reproducibility_fingerprint: string;
    temperature_range_c: [number, number];
    storage_range_mb: [number, number];
  } | null;
  evaluation_result: {
    mode: EvaluationMode;
    threshold_source: ThresholdSource;
    thresholds: Record<string, number>;
    priority: ThresholdSource[];
    priority_rank: number;
    conclusion: "passed" | "failed" | "not_applicable";
    is_product_commitment: boolean;
    metrics: Record<string, number>;
    distribution: Record<string, number>;
    trend: number[];
    summary: string;
  } | null;
  checks: Array<{
    name: string;
    category: "video" | "imu" | "storage";
    status: "passed" | "failed";
    message: string;
    metrics: Record<string, number | string>;
    anomaly_windows: Array<Record<string, number>>;
    truth_comparison: "matched" | "missed" | "not_applicable";
  }>;
  alignment_result: {
    reference_channel: ReferenceChannel;
    method: "fixed_offset_anchor" | "linear_drift_regression";
    parameters: Record<string, number>;
    drift_rates_s_per_s: Record<string, number>;
    anchors: Record<string, number[]>;
    pre_alignment: Record<string, Record<string, number>>;
    post_alignment: Record<string, Record<string, number>>;
    trend: Record<string, number[]>;
    anchor_details: AlignmentAnchor[];
    content_sync: ContentSyncResult;
    review_revision: number;
    truth_comparison: "matched" | "missed" | "not_applicable";
  } | null;
  manual_check_results: ManualCheckResult[];
  created_at: string;
  completed_at: string | null;
  error: string | null;
};

export type AlignmentAnchor = {
  id: string;
  channel: string;
  event_index: number;
  detected_time_s: number;
  reviewed_time_s: number | null;
  included: boolean;
  source: "video_flash" | "imu_peak";
};

export type ContentSyncResult = {
  status: "passed" | "failed" | "degraded";
  video_event_count: number;
  imu_event_count: number;
  matched_event_count: number;
  matched_event_indices: number[];
  message: string;
};

export type AlignmentReviewItem = {
  anchor_id: string;
  reviewed_time_s: number | null;
  included: boolean;
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

export async function getRun(runId: number): Promise<RunRecord> {
  const response = await fetch(`/api/runs/${runId}`);
  if (!response.ok) throw new Error("运行记录加载失败");
  return (await response.json()) as RunRecord;
}

export async function cancelRun(runId: number): Promise<RunRecord> {
  const response = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
  if (!response.ok) throw new Error("取消运行失败");
  return (await response.json()) as RunRecord;
}

export async function rerun(runId: number): Promise<RunRecord> {
  const response = await fetch(`/api/runs/${runId}/rerun`, { method: "POST" });
  if (!response.ok) throw new Error("重新执行失败");
  return (await response.json()) as RunRecord;
}

export async function reviewAlignment(
  runId: number,
  anchors: AlignmentReviewItem[],
): Promise<RunRecord> {
  const response = await fetch(`/api/runs/${runId}/alignment-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anchors }),
  });
  if (!response.ok) {
    const body = (await response.json()) as { detail?: string };
    throw new Error(body.detail ?? "锚点复核失败");
  }
  return (await response.json()) as RunRecord;
}
