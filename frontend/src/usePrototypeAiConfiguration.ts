import { useEffect, useState } from "react";

import {
  getAiConfig,
  verifyAiConnection,
  type AiNetworkMode,
} from "./aiSettingsApi";
import { refreshCatalog, testConnection } from "./aiConfigActions";
import { readCachedCatalog, writeCachedCatalog } from "./aiModelCatalogCache";
import {
  markVerificationInvalid,
  persistAiConfiguration,
} from "./aiConfigPersist";
import { applyRestoredAiConfig } from "./aiConfigRestore";
import {
  getActiveAiInvocation,
  setAiGlobalState,
  stopAiInvocationAndDisable,
  waitForAiInvocationFinish,
  type ActiveAiInvocation,
} from "./aiGlobalState";
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

/**
 * 选模型列表时的初始来源：优先用上次实时刷新缓存的目录，
 * 没有缓存才回退到内置目录，避免切页面后又出现“待实时校验”。
 */
function modelsForProvider(provider: ProviderKey): PrototypeAiModelOption[] {
  const cached = readCachedCatalog(provider);
  if (cached) return cached;
  return providers[provider].models.map((item) => ({ ...item }));
}

function isRemoteProvider(
  provider: ProviderKey,
): provider is Exclude<ProviderKey, "local"> {
  return provider !== "local";
}

export function usePrototypeAiConfiguration(
  onStateChanged?: () => Promise<void>,
) {
  const [provider, setProvider] = useState<ProviderKey>("deepseek");
  const [model, setModel] = useState<string>(providers.deepseek.models[0].id);
  const [availableModels, setAvailableModels] = useState(() =>
    modelsForProvider("deepseek"),
  );
  const [temporaryKey, setTemporaryKey] = useState(readRememberedTemporaryKey);
  const [rememberTemporaryKey, setRememberTemporaryKey] = useState(
    () => readRememberedTemporaryKey().length > 0,
  );
  const [accessMode, setAccessMode] = useState<AccessMode>("local");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connectionAction, setConnectionAction] = useState("");
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
  const [loadingAction, setLoadingAction] = useState<
    "catalog" | "test" | "save" | null
  >(null);
  const [saveConflict, setSaveConflict] = useState<ActiveAiInvocation | null>(
    null,
  );
  const [stoppingForSave, setStoppingForSave] = useState(false);
  const providerConfig = providers[provider];
  const modelLabel =
    availableModels.find((item) => item.id === model)?.label ?? model;
  const currentAccess =
    provider === "local"
      ? `本地服务 · ${modelLabel}`
      : `${accessMode === "local" ? "后端配置" : "临时 API"} · ${providerConfig.label} / ${modelLabel}`;

  /** 模型目录变化时同步写缓存，切页面或刷新后仍是同一份目录。 */
  const applyModels = (models: PrototypeAiModelOption[]) => {
    setAvailableModels(models);
    writeCachedCatalog(provider, models);
  };

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
          setAvailableModels: applyModels,
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
    setConnectionSucceeded(null);
    setConnectionMessage("");
    setConnectionAction("");
    markVerificationInvalid({
      setSavedMessage,
      setVerificationStatus,
      setVerificationMessage,
    });
  };

  const changeProvider = (nextProvider: ProviderKey) => {
    const nextModels = modelsForProvider(nextProvider);
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
        setConnectionAction,
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
        setAvailableModels: applyModels,
        setModelWarning,
      },
    });
  };

  const saveConfiguration = async () => {
    if (!isRemoteProvider(provider)) {
      setSavedMessage("本地服务配置暂不支持保存到后端。");
      return;
    }
    if (loadingAction !== null) return;
    setLoadingAction("save");
    try {
      const keySource =
        accessMode === "temporary" ? "temporary" : "environment";
      let saved = await persistAiConfiguration(
        { provider, model, key_source: keySource, network_mode: networkMode },
        { setVerificationStatus, setVerificationMessage, setSavedMessage },
      );
      if (!saved) {
        // 保存失败后检查运行锁，不在冲突时自动重试。
        try {
          const active = await getActiveAiInvocation();
          if (active) setSaveConflict(active);
        } catch {
          /* 保留原始保存错误 */
        }
        return;
      }
      const fingerprint = saved.snapshot?.fingerprint;
      if (verificationStatus !== "verified" && connectionSucceeded !== true) {
        if (saved.verification.status === "verified") {
          setVerificationStatus("invalidated");
          setVerificationMessage("请先验证当前表单配置");
        }
        setSavedMessage("AI 配置已保存，请先连接测试，再保存配置开启 AI。");
        return;
      }
      // 独立测试不可提升为正式验证。新配置保存后自动补做正式验证。
      if (
        saved.verification.status !== "verified" &&
        connectionSucceeded === true
      ) {
        setSavedMessage("AI 配置已保存，正在验证正式配置…");
        const result = await verifyAiConnection(
          provider,
          model,
          accessMode === "temporary" ? temporaryKey.trim() : "",
          { keySource, networkMode },
        );
        saved = await getAiConfig();
        setVerificationStatus(saved.verification.status);
        setVerificationMessage(saved.verification.message);
        if (!result.ok) {
          setSavedMessage(
            `AI 配置已保存，但正式连接验证失败：${result.message}`,
          );
          return;
        }
      }
      if (
        !fingerprint ||
        saved.snapshot?.fingerprint !== fingerprint ||
        saved.verification.status !== "verified" ||
        saved.verification.fingerprint !== fingerprint
      ) {
        setSavedMessage(
          "AI 配置已保存，尚未通过正式连接验证。请先连接测试，再保存配置开启 AI。",
        );
        return;
      }
      const enabled = await setAiGlobalState(true);
      setSavedMessage(
        enabled.enabled === true
          ? "AI 配置已保存，AI 已开启。"
          : "AI 配置已保存，但 AI 尚未开启。",
      );
    } catch (error) {
      setSavedMessage(
        `AI 配置已保存，但开启 AI 失败：${error instanceof Error ? error.message : "请求失败"}`,
      );
    } finally {
      await onStateChanged?.();
      setLoadingAction(null);
    }
  };

  const stopForConfigurationSave = async () => {
    if (!saveConflict || stoppingForSave) return;
    setStoppingForSave(true);
    try {
      await stopAiInvocationAndDisable(saveConflict.invocation_id);
      const finished = await waitForAiInvocationFinish(
        saveConflict.invocation_id,
        (next) => {
          if (next) setSaveConflict(next);
        },
      );
      if (!finished) {
        setSavedMessage(
          "停止请求仍在等待中，AI 仍被占用。请稍后查看状态；配置尚未保存。",
        );
        return;
      }
      setSaveConflict(null);
      await onStateChanged?.();
      setSavedMessage(
        "当前 AI 运行已停止，全局 AI 已关闭。请再次点击「保存 AI 配置」完成保存。",
      );
    } catch (error) {
      setSavedMessage(
        `停止 AI 运行失败：${error instanceof Error ? error.message : "请求失败"}`,
      );
    } finally {
      setStoppingForSave(false);
    }
  };

  const cancelConfigurationSave = () => setSaveConflict(null);
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
    connectionAction,
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
    saveConflict,
    stoppingForSave,
    stopForConfigurationSave,
    cancelConfigurationSave,
    validateConnectionConfiguration,
    refreshModelCatalog,
  };
}
