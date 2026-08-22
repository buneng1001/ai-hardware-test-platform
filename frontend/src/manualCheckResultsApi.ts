export type ManualCheckStatus = "passed" | "failed" | "blocked" | "not_run";

export const manualCheckStatusLabels: Record<ManualCheckStatus, string> = {
  passed: "通过",
  failed: "失败",
  blocked: "阻塞",
  not_run: "未执行",
};

export type ManualCheckResult = {
  id: number;
  run_id: number;
  name: string;
  status: ManualCheckStatus;
  actual_result: string | null;
  notes: string | null;
  executed_at: string | null;
  attachment: {
    filename: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
  } | null;
  created_at: string;
  updated_at: string;
};

export type ManualCheckResultCommand = {
  name: string;
  status: ManualCheckStatus;
  actual_result: string | null;
  notes: string | null;
  executed_at: string | null;
  attachment?: {
    filename: string;
    content_type: string;
    content_base64: string;
  };
};

async function readManualResult(
  response: Response,
): Promise<ManualCheckResult> {
  if (!response.ok) {
    throw new Error("人工检查结果保存失败");
  }
  return (await response.json()) as ManualCheckResult;
}

export async function createManualCheckResult(
  runId: number,
  command: ManualCheckResultCommand,
): Promise<ManualCheckResult> {
  const response = await fetch(`/api/runs/${runId}/manual-check-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  return readManualResult(response);
}

export async function updateManualCheckResult(
  runId: number,
  resultId: number,
  command: ManualCheckResultCommand,
): Promise<ManualCheckResult> {
  const response = await fetch(
    `/api/runs/${runId}/manual-check-results/${resultId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    },
  );
  return readManualResult(response);
}

type ImportErrorDetail = { row: number; field: string; message: string };

export async function importManualCheckResults(
  runId: number,
  file: File,
): Promise<ManualCheckResult[]> {
  const response = await fetch(
    `/api/runs/${runId}/manual-check-results/import?filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    },
  );
  if (!response.ok) {
    const payload = (await response.json()) as {
      detail?: ImportErrorDetail[] | string;
    };
    if (Array.isArray(payload.detail) && payload.detail.length > 0) {
      const firstError = payload.detail[0];
      throw new Error(
        `第 ${firstError.row} 行 ${firstError.field}：${firstError.message}`,
      );
    }
    throw new Error(
      typeof payload.detail === "string" ? payload.detail : "人工结果导入失败",
    );
  }
  return (await response.json()) as ManualCheckResult[];
}
