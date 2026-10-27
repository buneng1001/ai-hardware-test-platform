import { useState } from "react";

import { queryAiModelCatalog, verifyAiConnection } from "./aiSettingsApi";
import {
  prototypeAiProviders as providers,
  type PrototypeAiModelOption,
  type PrototypeAiProviderKey as ProviderKey,
} from "./V020PrototypeAiModels";

type AccessMode = "temporary" | "local";
const TEMPORARY_KEY_SESSION_STORAGE = "iris-test-temporary-ai-key";

function readRememberedTemporaryKey() {
  try {
    return window.sessionStorage.getItem(TEMPORARY_KEY_SESSION_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function storeTemporaryKey(value: string) {
  try {
    if (value) {
      window.sessionStorage.setItem(TEMPORARY_KEY_SESSION_STORAGE, value);
    } else {
      window.sessionStorage.removeItem(TEMPORARY_KEY_SESSION_STORAGE);
    }
    return true;
  } catch {
    return false;
  }
}

function initialModels(provider: ProviderKey): PrototypeAiModelOption[] {
  return providers[provider].models.map((item) => ({ ...item }));
}

function isRemoteProvider(
  provider: ProviderKey,
): provider is Exclude<ProviderKey, "local"> {
  return provider !== "local";
}

export function usePrototypeAiConfiguration() {
  const [provider, setProvider] = useState<ProviderKey>("deepseek");
  const [model, setModel] = useState<string>(providers.deepseek.models[0].id);
  const [availableModels, setAvailableModels] = useState(() =>
    initialModels("deepseek"),
  );
  const [temporaryKey, setTemporaryKey] = useState(readRememberedTemporaryKey);
  const [rememberTemporaryKey, setRememberTemporaryKey] = useState(
    () => readRememberedTemporaryKey().length > 0,
  );
  const [accessMode, setAccessMode] = useState<AccessMode>("local");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connectionSucceeded, setConnectionSucceeded] = useState<
    boolean | null
  >(null);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [loadingAction, setLoadingAction] = useState<"catalog" | "test" | null>(
    null,
  );
  const providerConfig = providers[provider];
  const modelLabel =
    availableModels.find((item) => item.id === model)?.label ?? model;
  const currentAccess =
    provider === "local"
      ? `本地服务 · ${modelLabel}`
      : `${accessMode === "local" ? "后端配置" : "临时 API"} · ${providerConfig.label} / ${modelLabel}`;

  const changeProvider = (nextProvider: ProviderKey) => {
    const nextModels = initialModels(nextProvider);
    setProvider(nextProvider);
    setAvailableModels(nextModels);
    setModel(nextModels[0].id);
    setConnectionMessage("");
    setConnectionSucceeded(null);
    setCatalogMessage("");
  };

  const changeTemporaryKey = (value: string) => {
    setTemporaryKey(value);
    if (rememberTemporaryKey) storeTemporaryKey(value);
    setConnectionMessage("");
    setConnectionSucceeded(null);
  };

  const changeRememberTemporaryKey = (remember: boolean) => {
    setRememberTemporaryKey(remember);
    storeTemporaryKey(remember ? temporaryKey : "");
  };

  const clearTemporaryKey = () => {
    setTemporaryKey("");
    storeTemporaryKey("");
    setAccessMode("local");
    setConnectionMessage("");
    setConnectionSucceeded(null);
  };

  const chooseAccessMode = (mode: AccessMode) => {
    setAccessMode(mode);
    setConnectionMessage("");
    setConnectionSucceeded(null);
  };

  const validateConnectionConfiguration = async () => {
    if (!isRemoteProvider(provider)) {
      setConnectionMessage("本地服务连接测试将在本机模型服务接入后执行。");
      setConnectionSucceeded(null);
      return;
    }
    setLoadingAction("test");
    setConnectionMessage("");
    try {
      const result = await verifyAiConnection(
        provider,
        model,
        accessMode === "temporary" ? temporaryKey.trim() : "",
      );
      setConnectionMessage(
        `${result.ok ? "连接成功" : "连接失败"}：${providerConfig.label} / ${modelLabel}：${result.message}`,
      );
      setConnectionSucceeded(result.ok);
    } catch (error) {
      const message = error instanceof Error ? error.message : "请求失败";
      setConnectionMessage(`连接测试失败：${message}`);
      setConnectionSucceeded(false);
    } finally {
      setLoadingAction(null);
    }
  };

  const refreshModelCatalog = async () => {
    if (!isRemoteProvider(provider)) {
      setCatalogMessage(
        "本地服务的可用模型由本机运行环境提供，请在接入时读取本地目录。",
      );
      return;
    }
    setLoadingAction("catalog");
    setCatalogMessage("");
    try {
      const result = await queryAiModelCatalog(provider, temporaryKey.trim());
      const knownModels = new Map(
        initialModels(provider).map((item) => [item.id, item]),
      );
      const nextModels = result.models.map(
        (id): PrototypeAiModelOption =>
          knownModels.get(id) ?? { id, label: id, availability: "verified" },
      );
      setAvailableModels(nextModels);
      if (!nextModels.some((item) => item.id === model)) {
        setModel(nextModels[0]?.id ?? "");
      }
      setCatalogMessage(
        result.source === "provider"
          ? `已从 ${providerConfig.label} 实时获取 ${nextModels.length} 个可用模型。`
          : `${result.warning ?? "未能读取实时模型目录。"} 共 ${nextModels.length} 个候选模型。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "请求失败";
      setCatalogMessage(`模型目录刷新失败：${message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  return {
    provider,
    model,
    setModel,
    availableModels,
    temporaryKey,
    rememberTemporaryKey,
    accessMode,
    connectionMessage,
    connectionSucceeded,
    catalogMessage,
    loadingAction,
    providerConfig,
    currentAccess,
    canUseTemporaryApi: temporaryKey.trim().length > 0,
    changeProvider,
    changeTemporaryKey,
    changeRememberTemporaryKey,
    clearTemporaryKey,
    chooseAccessMode,
    validateConnectionConfiguration,
    refreshModelCatalog,
  };
}
