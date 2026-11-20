import { jsonHeaders, request } from "./apiClient";

export type AiGlobalState = {
  enabled: boolean;
  can_enable: boolean;
  reason: string | null;
  provider: string | null;
  model: string | null;
};

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
