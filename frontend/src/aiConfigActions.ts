import {
  queryAiModelCatalog,
  verifyAiConnection,
  type AiNetworkMode,
} from "./aiSettingsApi";
import {
  prototypeAiProviders as providers,
  type PrototypeAiModelOption,
  type PrototypeAiProviderKey as ProviderKey,
} from "./V020PrototypeAiModels";

function providerModels(provider: ProviderKey): PrototypeAiModelOption[] {
  return providers[provider].models.map((item) => ({ ...item }));
}

export async function refreshCatalog(params: {
  provider: Exclude<ProviderKey, "local">;
  model: string;
  apiKey: string;
  networkMode: AiNetworkMode;
  providerLabel: string;
  setters: {
    setLoadingAction: (action: "catalog" | "test" | null) => void;
    setCatalogMessage: (message: string) => void;
    setAvailableModels: (models: PrototypeAiModelOption[]) => void;
    setModelWarning: (message: string) => void;
  };
}) {
  const { setters } = params;
  setters.setLoadingAction("catalog");
  setters.setCatalogMessage("");
  try {
    const result = await queryAiModelCatalog(
      params.provider,
      params.apiKey.trim(),
      params.networkMode,
    );
    const known = new Map(
      providerModels(params.provider).map((item) => [item.id, item]),
    );
    const nextModels = result.models.map(
      (id): PrototypeAiModelOption =>
        known.get(id) ?? { id, label: id, availability: "verified" },
    );
    if (nextModels.some((item) => item.id === params.model)) {
      setters.setAvailableModels(nextModels);
      setters.setModelWarning("");
    } else {
      setters.setAvailableModels([
        {
          id: params.model,
          label: `${params.model}（不在最新目录）`,
          availability: "candidate",
        },
        ...nextModels,
      ]);
      setters.setModelWarning(
        `当前模型 ${params.model} 不在最新目录中，请手动确认或更换模型。`,
      );
    }
    setters.setCatalogMessage(
      result.source === "provider"
        ? `已从 ${params.providerLabel} 实时获取 ${nextModels.length} 个可用模型。`
        : `${result.warning ?? "未能读取实时模型目录。"} 共 ${nextModels.length} 个候选模型。`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求失败";
    setters.setCatalogMessage(`模型目录刷新失败：${message}`);
  } finally {
    setters.setLoadingAction(null);
  }
}

export async function testConnection(params: {
  provider: Exclude<ProviderKey, "local">;
  model: string;
  apiKey: string;
  accessMode: "temporary" | "local";
  networkMode: AiNetworkMode;
  providerLabel: string;
  modelLabel: string;
  setters: {
    setLoadingAction: (action: "catalog" | "test" | null) => void;
    setConnectionMessage: (message: string) => void;
    setConnectionSucceeded: (value: boolean | null) => void;
    setConnectionAction: (message: string) => void;
    setVerificationStatus: (
      status: "verified" | "failed" | "invalidated" | "untested",
    ) => void;
    setVerificationMessage: (message: string) => void;
    setModelWarning: (message: string) => void;
  };
}) {
  const { setters } = params;
  setters.setLoadingAction("test");
  setters.setConnectionMessage("");
  try {
    const result = await verifyAiConnection(
      params.provider,
      params.model,
      params.apiKey.trim(),
      {
        keySource:
          params.accessMode === "temporary" ? "temporary" : "environment",
        networkMode: params.networkMode,
      },
    );
    const networkNote = result.network_diagnostic
      ? `（网络诊断：${result.network_diagnostic}）`
      : "";
    setters.setConnectionMessage(
      `${result.ok ? "连接成功" : "连接失败"}：${params.providerLabel} / ${params.modelLabel}：${result.message}${networkNote}`,
    );
    setters.setConnectionSucceeded(result.ok);
    setters.setConnectionAction(result.ok ? "" : (result.error?.action ?? ""));
    setters.setVerificationStatus(result.ok ? "verified" : "failed");
    setters.setVerificationMessage(result.message);
    setters.setModelWarning("");
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求失败";
    setters.setConnectionMessage(`连接测试失败：${message}`);
    setters.setConnectionSucceeded(false);
    setters.setConnectionAction("");
    setters.setVerificationStatus("failed");
    setters.setVerificationMessage(message);
  } finally {
    setters.setLoadingAction(null);
  }
}
