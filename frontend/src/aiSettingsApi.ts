import { jsonHeaders, request } from "./apiClient";

export type RemoteAiProvider = "siliconflow" | "deepseek" | "kimi";
export type AiNetworkMode = "auto" | "system_proxy" | "direct";
export type AiKeySource = "environment" | "temporary";

export type AiConfigSnapshot = {
  provider: RemoteAiProvider;
  endpoint: string;
  model: string;
  key_source: AiKeySource;
  network_mode: AiNetworkMode;
  prompt_version: string;
  fingerprint: string;
  created_at: string;
};

export type AiConfigState = {
  snapshot: AiConfigSnapshot | null;
  catalog: {
    provider: RemoteAiProvider;
    models: string[];
    source: "provider" | "configured";
    warning: string | null;
    fetched_at: string;
    selected_model: string;
    selected_model_available: boolean;
  } | null;
  verification: {
    status: "verified" | "failed" | "invalidated" | "untested";
    message: string;
    fingerprint: string | null;
    error_kind: string | null;
    retryable: boolean;
    network_diagnostic: string | null;
    verified_at: string | null;
  };
  network_modes: string[];
};

export type AiErrorDetail = {
  action: string;
  stage?: string;
  kind?: string;
  retryable?: boolean;
  user_message?: string;
  diagnostic?: string | null;
  provider?: string | null;
  model?: string | null;
  endpoint_host?: string | null;
  network_mode?: string | null;
  prompt_version?: string | null;
  elapsed_ms?: number | null;
  attempts?: number | null;
  http_status?: number | null;
  finish_reason?: string | null;
  response_chars?: number | null;
};

export type AiModelCatalogResponse = {
  provider: RemoteAiProvider;
  models: string[];
  source: "provider" | "configured";
  warning: string | null;
};

export type AiConnectionTestResponse = {
  ok: boolean;
  provider: RemoteAiProvider;
  model: string;
  error_kind: string | null;
  retryable: boolean;
  message: string;
  config_fingerprint?: string | null;
  network_diagnostic?: string | null;
  error?: AiErrorDetail | null;
};

export function getAiConfig() {
  return request<AiConfigState>("/api/settings/ai/config");
}

export function saveAiConfig(input: {
  provider: RemoteAiProvider;
  model: string;
  key_source: AiKeySource;
  network_mode: AiNetworkMode;
}) {
  return request<AiConfigState>("/api/settings/ai/config", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
}

export function queryAiModelCatalog(
  provider: RemoteAiProvider,
  apiKey: string,
  networkMode: AiNetworkMode = "auto",
) {
  return request<AiModelCatalogResponse>("/api/settings/ai/models/query", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      provider,
      api_key: apiKey,
      network_mode: networkMode,
    }),
  });
}

export function verifyAiConnection(
  provider: RemoteAiProvider,
  model: string,
  apiKey: string,
  options: { keySource?: AiKeySource; networkMode?: AiNetworkMode } = {},
) {
  return request<AiConnectionTestResponse>("/api/settings/ai/test", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      provider,
      model,
      api_key: apiKey,
      key_source: options.keySource ?? "environment",
      network_mode: options.networkMode ?? "auto",
    }),
  });
}
