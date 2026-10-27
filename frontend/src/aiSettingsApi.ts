import { jsonHeaders, request } from "./apiClient";

export type RemoteAiProvider = "siliconflow" | "deepseek" | "kimi";

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
};

export function queryAiModelCatalog(
  provider: RemoteAiProvider,
  apiKey: string,
) {
  return request<AiModelCatalogResponse>("/api/settings/ai/models/query", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
}

export function verifyAiConnection(
  provider: RemoteAiProvider,
  model: string,
  apiKey: string,
) {
  return request<AiConnectionTestResponse>("/api/settings/ai/test", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ provider, model, api_key: apiKey }),
  });
}
