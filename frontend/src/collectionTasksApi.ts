import type { ManualCheckResult } from "./manualCheckResultsApi";
import {
  createDiagnosis,
  listDiagnoses,
  type DiagnosisMode,
  type DiagnosisRun,
} from "./diagnosisApi";

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
  source?: "synthetic_generated" | "imported_actual_data";
  archived?: boolean;
  created_at: string;
};

export type SavedTask = {
  id: number;
  name: string;
  source: "synthetic_generated" | "imported_actual_data";
  execution_status: "never_executed" | "has_runs";
  archived: boolean;
  run_count: number;
  created_at: string;
};

export type SavedTaskPage = {
  items: SavedTask[];
  page: number;
  page_size: number;
  total: number;
};

export type ImportValidation = {
  status: "passed" | "failed";
  security: { status: "passed" | "failed"; errors: string[] };
  compatibility: { status: "passed" | "failed"; errors: string[] };
  errors: string[];
  warnings: string[];
  manifest: Record<string, unknown> | null;
};

export type ImportRecord = {
  id: number;
  sha256: string;
  source_filename: string;
  first_imported_at: string;
  validator_version: string;
  status:
    "uploaded" | "passed" | "failed" | "nonstandard_convertible" | "imported";
  permission_confirmed: boolean;
  validation: ImportValidation;
  created_task_id: number | null;
};

export type DataMode = "quick" | "standard" | "custom";
export type Scenario =
  | "normal"
  | "video_drop"
  | "imu_anomaly"
  | "storage_exhaustion"
  | "temperature_combination"
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
  bitrate_kbps?: number;
  bitrate_mode?: "cbr" | "vbr";
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
  task_name?: string;
  task_execution_number?: number;
  queue_position?: number | null;
  stage_status?: RunStatus;
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
    start_raw_device_timestamp_ns: number | null;
  }>;
  generation_metadata: {
    timeline_source: "actual_generated" | "virtual_time_simulated";
    requested_duration_seconds: number;
    generated_duration_seconds: number;
    reproducibility_fingerprint: string;
    temperature_range_c: [number, number];
    storage_range_mb: [number, number];
    time_contract?: Record<string, unknown>;
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
    category: "video" | "imu" | "resource" | "log" | "storage";
    status: "passed" | "failed";
    message: string;
    metrics: Record<string, number | string>;
    anomaly_windows: Array<Record<string, number>>;
    truth_comparison: "matched" | "missed" | "not_applicable";
    evidence_refs: string[];
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
    frame_imu_alignment: {
      artifact_path: string;
      frame_count: number;
      matched_count: number;
      unmatched_count: number;
      imu_sample_rate_hz: number;
      tolerance_s: number;
      columns: string[];
    } | null;
    review_revision: number;
    truth_comparison: "matched" | "missed" | "not_applicable";
  } | null;
  manual_check_results: ManualCheckResult[];
  created_at: string;
  completed_at: string | null;
  error: string | null;
};

export type { DiagnosisRun } from "./diagnosisApi";
export type { DiagnosisMode } from "./diagnosisApi";
export type { DiagnosisProvider } from "./diagnosisApi";
export { createDiagnosis, listDiagnoses } from "./diagnosisApi";
export type AiSettings = {
  provider: "siliconflow" | "deepseek" | "kimi";
  model: string;
  mode: DiagnosisMode;
  api_key_configured: boolean;
  providers: Array<{
    provider: "siliconflow" | "deepseek" | "kimi";
    models: string[];
    api_key_configured: boolean;
  }>;
};
export type ConnectionTestResult = {
  ok: boolean;
  provider: "siliconflow" | "deepseek" | "kimi";
  model: string;
  error_kind: string | null;
  retryable: boolean;
  message: string;
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

export async function listSavedTasks(
  page = 1,
  filters: {
    source?: SavedTask["source"];
    execution_status?: SavedTask["execution_status"];
    archived?: boolean;
  } = {},
): Promise<SavedTaskPage> {
  const params = new URLSearchParams({ page: String(page), page_size: "10" });
  if (filters.source) params.set("source", filters.source);
  if (filters.execution_status)
    params.set("execution_status", filters.execution_status);
  if (filters.archived !== undefined)
    params.set("archived", String(filters.archived));
  const response = await fetch(
    `/api/collection-tasks/saved?${params.toString()}`,
  );
  if (!response.ok) throw new Error("已保存任务加载失败");
  return (await response.json()) as SavedTaskPage;
}

export async function deleteCollectionTask(taskId: number): Promise<void> {
  const response = await fetch(`/api/collection-tasks/${taskId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const body = (await response.json()) as { detail?: string };
    throw new Error(body.detail ?? "任务删除失败");
  }
}

export async function archiveCollectionTask(
  taskId: number,
): Promise<SavedTask> {
  const response = await fetch(`/api/collection-tasks/${taskId}/archive`, {
    method: "POST",
  });
  if (!response.ok) throw new Error("任务归档失败");
  return (await response.json()) as SavedTask;
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

export async function uploadImport(
  file: File,
  permissionConfirmed: boolean,
): Promise<ImportRecord> {
  const form = new FormData();
  form.append("file", file);
  form.append("permission_confirmed", String(permissionConfirmed));
  const response = await fetch("/api/imports", { method: "POST", body: form });
  if (!response.ok) {
    const body = (await response.json()) as { detail?: string };
    throw new Error(body.detail ?? "实际测试文件上传失败");
  }
  return (await response.json()) as ImportRecord;
}

export async function validateImport(importId: number): Promise<ImportRecord> {
  const response = await fetch(`/api/imports/${importId}/validate`, {
    method: "POST",
  });
  const body = (await response.json()) as
    ImportRecord | { detail?: { errors?: string[] } };
  if (!response.ok) {
    const errors =
      "detail" in body ? body.detail?.errors?.join("；") : undefined;
    throw new Error(errors ?? "实际测试文件校验失败");
  }
  return body as ImportRecord;
}

export async function convertImport(importId: number): Promise<void> {
  const response = await fetch(`/api/imports/${importId}/convert`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = (await response.json()) as { detail?: string };
    throw new Error(body.detail ?? "标准格式转换功能开发中");
  }
}

export async function createImportedTask(
  importId: number,
  name: string,
  label: string,
): Promise<CollectionTask> {
  const response = await fetch(`/api/imports/${importId}/create-task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, label }),
  });
  if (!response.ok) {
    const body = (await response.json()) as { detail?: string };
    throw new Error(body.detail ?? "导入任务创建失败");
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

export async function getAiSettings(): Promise<AiSettings> {
  const response = await fetch("/api/settings/ai");
  if (!response.ok) throw new Error("AI 设置加载失败");
  return (await response.json()) as AiSettings;
}

export async function testAiConnection(
  model: string,
  apiKey: string,
  provider: "siliconflow" | "deepseek" | "kimi" = "siliconflow",
): Promise<ConnectionTestResult> {
  const response = await fetch("/api/settings/ai/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      api_key: apiKey,
      ...(provider !== "siliconflow" && { provider }),
    }),
  });
  if (!response.ok) throw new Error("AI 连接测试失败");
  return (await response.json()) as ConnectionTestResult;
}

export const createMockDiagnosis = (runId: number) =>
  createDiagnosis(runId, "mock", "mock-diagnosis-v1", "");

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
