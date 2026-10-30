import {
  saveAiConfig,
  type AiConfigState,
  type AiKeySource,
  type AiNetworkMode,
} from "./aiSettingsApi";

type PersistSetters = {
  setLoadingAction: (action: "catalog" | "test" | null) => void;
  setVerificationStatus: (
    status: "verified" | "failed" | "invalidated" | "untested",
  ) => void;
  setVerificationMessage: (message: string) => void;
  setSavedMessage: (message: string) => void;
};

/** 任一配置字段变化后旧的验证结论立即失效。 */
export function markVerificationInvalid(setters: {
  setSavedMessage: (message: string) => void;
  setVerificationStatus: (
    updater: (
      current: "verified" | "failed" | "invalidated" | "untested",
    ) => "verified" | "failed" | "invalidated" | "untested",
  ) => void;
  setVerificationMessage: (message: string) => void;
}) {
  setters.setSavedMessage("");
  setters.setVerificationStatus((current) =>
    current === "untested" ? "untested" : "invalidated",
  );
  setters.setVerificationMessage("配置已修改，请重新测试");
}

/** 保存当前配置并同步验证状态；密钥只以来源形式保存。 */
export async function persistAiConfiguration(
  command: {
    provider: "deepseek" | "siliconflow" | "kimi";
    model: string;
    key_source: AiKeySource;
    network_mode: AiNetworkMode;
  },
  setters: PersistSetters,
) {
  setters.setLoadingAction("test");
  setters.setSavedMessage("");
  try {
    const state: AiConfigState = await saveAiConfig(command);
    setters.setVerificationStatus(state.verification.status);
    setters.setVerificationMessage(state.verification.message);
    setters.setSavedMessage("AI 配置已保存，应用重启后可恢复。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求失败";
    setters.setSavedMessage(`配置保存失败：${message}`);
  } finally {
    setters.setLoadingAction(null);
  }
}
