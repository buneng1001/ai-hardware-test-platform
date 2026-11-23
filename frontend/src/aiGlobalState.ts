import { jsonHeaders, request } from "./apiClient";

export type AiGlobalState = {
  enabled: boolean;
  can_enable: boolean;
  reason: string | null;
  provider: string | null;
  model: string | null;
};

export type ActiveAiInvocation = {
  invocation_id: string;
  operation_type: string;
  display_name: string;
  project_id: number | null;
  project_name: string | null;
  resource_id: number | null;
  status: "running";
  stopping: boolean;
  started_at: string;
  cancel_requested_at: string | null;
  config_fingerprint: string;
  execution_mode: "single_request" | "checkpointed_batch";
  input_fingerprint: string | null;
};

export async function getActiveAiInvocation() {
  const result = await request<{ active: ActiveAiInvocation | null }>(
    "/api/settings/ai/active-invocation",
  );
  return result.active;
}

export async function stopAiInvocationAndDisable(invocationId: string) {
  return request<{ active: ActiveAiInvocation | null; enabled: boolean }>(
    `/api/settings/ai/invocations/${encodeURIComponent(invocationId)}/stop-and-disable`,
    { method: "POST" },
  );
}

export async function waitForAiInvocationFinish(
  invocationId: string,
  onPending?: (active: ActiveAiInvocation | null) => void,
  timeoutMs = 10 * 60 * 1000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const active = await getActiveAiInvocation();
    if (!active || active.invocation_id !== invocationId) return true;
    onPending?.(active);
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  return false;
}

export function getAiGlobalState() {
  return request<AiGlobalState>("/api/settings/ai/state");
}

export function setAiGlobalState(enabled: boolean) {
  return request<AiGlobalState>("/api/settings/ai/state", {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify({ enabled }),
  });
}
