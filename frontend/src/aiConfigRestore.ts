import type { AiConfigState } from "./aiSettingsApi";
import {
  prototypeAiProviders as providers,
  type PrototypeAiModelOption,
  type PrototypeAiProviderKey as ProviderKey,
} from "./V020PrototypeAiModels";

type RestoreSetters = {
  setProvider: (provider: ProviderKey) => void;
  setModel: (model: string) => void;
  setAccessMode: (mode: "temporary" | "local") => void;
  setNetworkMode: (mode: "auto" | "system_proxy" | "direct") => void;
  setVerificationStatus: (
    status: "verified" | "failed" | "invalidated" | "untested",
  ) => void;
  setVerificationMessage: (message: string) => void;
  setAvailableModels: (models: PrototypeAiModelOption[]) => void;
  setModelWarning: (message: string) => void;
};

/** 把持久化配置恢复到冻结版首页；本地服务不支持保存，直接忽略。 */
export function applyRestoredAiConfig(
  state: AiConfigState,
  setters: RestoreSetters,
) {
  if (!state.snapshot) return;
  const provider = state.snapshot.provider;
  if (provider !== "deepseek" && provider !== "siliconflow") return;
  setters.setProvider(provider);
  setters.setModel(state.snapshot.model);
  setters.setAccessMode(
    state.snapshot.key_source === "temporary" ? "temporary" : "local",
  );
  setters.setNetworkMode(state.snapshot.network_mode);
  setters.setVerificationStatus(state.verification.status);
  setters.setVerificationMessage(state.verification.message);
  if (!state.catalog) return;
  const known = new Map<string, PrototypeAiModelOption>(
    providers[provider].models.map((item) => [item.id, item]),
  );
  setters.setAvailableModels(
    state.catalog.models.map(
      (id): PrototypeAiModelOption =>
        known.get(id) ?? { id, label: id, availability: "candidate" },
    ),
  );
  if (!state.catalog.selected_model_available) {
    setters.setAvailableModels([
      {
        id: state.snapshot.model,
        label: `${state.snapshot.model}（不在最新目录）`,
        availability: "candidate",
      },
      ...state.catalog.models.map(
        (id): PrototypeAiModelOption =>
          known.get(id) ?? { id, label: id, availability: "candidate" },
      ),
    ]);
    setters.setModelWarning(
      `当前模型 ${state.snapshot.model} 不在最新目录中，请手动确认或重新测试。`,
    );
  }
}
