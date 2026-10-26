import { useState } from "react";

const providers = {
  deepseek: {
    label: "DeepSeek",
    models: ["DeepSeek-V4.0-Flash", "DeepSeek-V3.2"],
    preset: "已配置预设 API Key，无需填写",
  },
  siliconflow: {
    label: "SiliconFlow",
    models: ["Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3"],
    preset: "可使用预设 API Key，也可临时覆盖",
  },
  local: {
    label: "本地服务",
    models: ["OpenAI / gpt-4o", "Ollama / qwen2.5:72b"],
    preset: "由本地服务提供连接凭据",
  },
} as const;

type ProviderKey = keyof typeof providers;
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
    if (value)
      window.sessionStorage.setItem(TEMPORARY_KEY_SESSION_STORAGE, value);
    else window.sessionStorage.removeItem(TEMPORARY_KEY_SESSION_STORAGE);
    return true;
  } catch {
    return false;
  }
}

export function PrototypeAiConfiguration({ onSkip }: { onSkip: () => void }) {
  const [provider, setProvider] = useState<ProviderKey>("deepseek");
  const [model, setModel] = useState<string>(providers.deepseek.models[0]);
  const [temporaryKey, setTemporaryKey] = useState(readRememberedTemporaryKey);
  const [rememberTemporaryKey, setRememberTemporaryKey] = useState(
    () => readRememberedTemporaryKey().length > 0,
  );
  const [accessMode, setAccessMode] = useState<AccessMode>("local");
  const [connectionMessage, setConnectionMessage] = useState("");
  const providerConfig = providers[provider];
  const currentAccess =
    accessMode === "local"
      ? "本地 API · OpenAI / gpt-4o"
      : `临时 API · ${providerConfig.label} / ${model}`;

  const changeProvider = (nextProvider: ProviderKey) => {
    setProvider(nextProvider);
    setModel(providers[nextProvider].models[0]);
    setConnectionMessage("");
  };
  const changeTemporaryKey = (value: string) => {
    setTemporaryKey(value);
    if (rememberTemporaryKey) storeTemporaryKey(value);
    setConnectionMessage("");
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
  };
  const chooseAccessMode = (mode: AccessMode) => {
    setAccessMode(mode);
    setConnectionMessage("");
  };
  const validateConnectionConfiguration = () => {
    setConnectionMessage("配置项已校验；连接请求将在 API 能力接入后执行。");
  };
  const canUseTemporaryApi = temporaryKey.trim().length > 0;

  return (
    <section className="prototype-ai-card" aria-labelledby="prototype-ai-title">
      <div className="prototype-ai-heading">
        <div>
          <div className="prototype-kicker">AI 配置</div>
          <h2 id="prototype-ai-title">配置你的 AI 模型</h2>
        </div>
        <span className="prototype-ai-status">可选配置</span>
      </div>
      <p className="prototype-muted">
        用于自动化用例转换与最终报告分析，可随时切换临时或本地接入。
      </p>

      <div className="prototype-ai-fields">
        <label className="prototype-ai-field">
          <span className="prototype-ai-field-label">
            <span aria-hidden="true">☁</span> 服务商
          </span>
          <select
            aria-label="服务商"
            value={provider}
            onChange={(event) =>
              changeProvider(event.target.value as ProviderKey)
            }
          >
            {Object.entries(providers).map(([key, config]) => (
              <option key={key} value={key}>
                {config.label}
              </option>
            ))}
          </select>
          <small>{providerConfig.preset}</small>
        </label>

        <label className="prototype-ai-field">
          <span className="prototype-ai-field-label">
            <span aria-hidden="true">▣</span> 模型
          </span>
          <select
            aria-label="模型"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            {providerConfig.models.map((modelName) => (
              <option key={modelName}>{modelName}</option>
            ))}
          </select>
          <small>可选模型由上方服务商决定</small>
        </label>

        <label className="prototype-ai-field">
          <span className="prototype-ai-field-label">
            <span aria-hidden="true">⌁</span> 临时 API Key
          </span>
          <input
            aria-label="临时 API Key"
            type="password"
            autoComplete="off"
            value={temporaryKey}
            onChange={(event) => changeTemporaryKey(event.target.value)}
          />
          <small>仅用于当前前端配置，不随项目数据提交</small>
        </label>
      </div>

      <div className="prototype-ai-key-actions">
        <label>
          <input
            type="checkbox"
            checked={rememberTemporaryKey}
            onChange={(event) =>
              changeRememberTemporaryKey(event.target.checked)
            }
          />
          本次会话记住临时 API
        </label>
        <button
          className="prototype-secondary"
          type="button"
          onClick={clearTemporaryKey}
        >
          清除临时 API
        </button>
      </div>

      <div className="prototype-ai-current">
        <span className="prototype-ai-current-icon" aria-hidden="true">
          ◇
        </span>
        <span>
          <small>当前接入</small>
          <strong>{currentAccess}</strong>
        </span>
      </div>

      <div className="prototype-ai-mode-actions">
        <button
          className={
            accessMode === "temporary" ? "prototype-ai-mode-active" : ""
          }
          type="button"
          aria-pressed={accessMode === "temporary"}
          disabled={!canUseTemporaryApi}
          title={canUseTemporaryApi ? undefined : "请先填写临时 API Key"}
          onClick={() => chooseAccessMode("temporary")}
        >
          使用临时 API 接入
        </button>
        <button
          className={accessMode === "local" ? "prototype-ai-mode-active" : ""}
          type="button"
          aria-pressed={accessMode === "local"}
          onClick={() => chooseAccessMode("local")}
        >
          使用本地 API 接入
        </button>
      </div>
      <button
        className="prototype-ai-test"
        type="button"
        onClick={validateConnectionConfiguration}
      >
        AI 连接测试
      </button>
      {connectionMessage && (
        <p className="prototype-ai-feedback" role="status">
          {connectionMessage}
        </p>
      )}
      <button className="prototype-ai-skip" type="button" onClick={onSkip}>
        暂不配置，进入平台
      </button>
    </section>
  );
}
