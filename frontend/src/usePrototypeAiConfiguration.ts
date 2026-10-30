import { useEffect, useState } from "react";

import { getAiConfig, type AiNetworkMode } from "./aiSettingsApi";
import { refreshCatalog, testConnection } from "./aiConfigActions";
import {
  markVerificationInvalid,
  persistAiConfiguration,
} from "./aiConfigPersist";
import { applyRestoredAiConfig } from "./aiConfigRestore";
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
  const [networkMode, setNetworkMode] = useState<AiNetworkMode>("auto");
  const [verificationStatus, setVerificationStatus] = useState<
    "verified" | "failed" | "invalidated" | "untested"
  >("untested");
  const [verificationMessage, setVerificationMessage] = useState("");
  const [modelWarning, setModelWarning] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
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

  useEffect(() => {
    let cancelled = false;
    void getAiConfig()
      .then((state) => {
        if (cancelled) return;
        applyRestoredAiConfig(state, {
          setProvider,
          setModel,
          setAccessMode,
          setNetworkMode,
          setVerificationStatus,
          setVerificationMessage,
          setAvailableModels,
          setModelWarning,
        });
      })
      .catch(() => {
        // 后端不可用时保留本地默认配置，不阻塞进入平台。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const invalidateVerification = () => {
    markVerificationInvalid({
      setSavedMessage,
      setVerificationStatus,
      setVerificationMessage,
    });
  };

  const changeProvider = (nextProvider: ProviderKey) => {
    const nextModels = initialModels(nextProvider);
    setProvider(nextProvider);
    setAvailableModels(nextModels);
    setModel(nextModels[0].id);
    setConnectionMessage("");
    setConnectionSucceeded(null);
    setCatalogMessage("");
    setModelWarning("");
    invalidateVerification();
  };

  const changeModel = (nextModel: string) => {
    setModel(nextModel);
    invalidateVerification();
  };

  const changeNetworkMode = (mode: AiNetworkMode) => {
    setNetworkMode(mode);
    setSavedMessage("");
    invalidateVerification();
  };

  const changeTemporaryKey = (value: string) => {
    setTemporaryKey(value);
    if (rememberTemporaryKey) storeTemporaryKey(value);
    setConnectionMessage("");
    setConnectionSucceeded(null);
    invalidateVerification();
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
    invalidateVerification();
  };

  const chooseAccessMode = (mode: AccessMode) => {
    setAccessMode(mode);
    setConnectionMessage("");
    setConnectionSucceeded(null);
    invalidateVerification();
  };

  const validateConnectionConfiguration = async () => {
    if (!isRemoteProvider(provider)) {
      setConnectionMessage("本地服务连接测试将在本机模型服务接入后执行。");
      setConnectionSucceeded(null);
      return;
    }
    await testConnection({
      provider,
      model,
      apiKey: accessMode === "temporary" ? temporaryKey : "",
      accessMode,
      networkMode,
      providerLabel: providerConfig.label,
      modelLabel,
      setters: {
        setLoadingAction,
        setConnectionMessage,
        setConnectionSucceeded,
        setVerificationStatus,
        setVerificationMessage,
        setModelWarning,
      },
    });
  };

  const refreshModelCatalog = async () => {
    if (!isRemoteProvider(provider)) {
      setCatalogMessage(
        "本地服务的可用模型由本机运行环境提供，请在接入时读取本地目录。",
      );
      return;
    }
    await refreshCatalog({
      provider,
      model,
      apiKey: temporaryKey,
      networkMode,
      providerLabel: providerConfig.label,
      setters: {
        setLoadingAction,
        setCatalogMessage,
        setAvailableModels,
        setModelWarning,
      },
    });
  };

  const saveConfiguration = async () => {
    if (!isRemoteProvider(provider)) {
      setSavedMessage("本地服务配置暂不支持保存到后端。");
      return;
    }
    await persistAiConfiguration(
      {
        provider,
        model,
        key_source: accessMode === "temporary" ? "temporary" : "environment",
        network_mode: networkMode,
      },
      {
        setLoadingAction,
        setVerificationStatus,
        setVerificationMessage,
        setSavedMessage,
      },
    );
  };

  return {
    provider,
    model,
    setModel: changeModel,
    availableModels,
    temporaryKey,
    rememberTemporaryKey,
    accessMode,
    networkMode,
    connectionMessage,
    connectionSucceeded,
    verificationStatus,
    verificationMessage,
    modelWarning,
    savedMessage,
    catalogMessage,
    loadingAction,
    providerConfig,
    currentAccess,
    canUseTemporaryApi: temporaryKey.trim().length > 0,
    changeProvider,
    changeNetworkMode,
    changeTemporaryKey,
    changeRememberTemporaryKey,
    clearTemporaryKey,
    chooseAccessMode,
    saveConfiguration,
    validateConnectionConfiguration,
    refreshModelCatalog,
  };
}
