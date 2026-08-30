import type {
  AiSettings,
  DiagnosisMode,
  DiagnosisProvider,
} from "./collectionTasksApi";

type SettingsPanelProps = {
  mode: DiagnosisMode;
  provider: DiagnosisProvider;
  model: string;
  apiKey: string;
  message: string | null;
  testing: boolean;
  backend: AiSettings | null;
  onModeChange: (mode: DiagnosisMode, provider?: DiagnosisProvider) => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onTest: () => void;
  onLocalTest: () => void;
};

const defaultModels: Record<DiagnosisProvider, string[]> = {
  siliconflow: [
    "zai-org/GLM-5.2",
    "zai-org/GLM-4.5V",
    "Pro/moonshotai/Kimi-K2.6",
    "MiniMaxAI/MiniMax-M2.5",
    "deepseek-ai/DeepSeek-V3.2",
    "Qwen/Qwen3.6-27B",
    "Qwen/Qwen3.5-27B",
    "Qwen/Qwen3-8B",
    "Qwen/Qwen2.5-72B-Instruct",
  ],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  kimi: ["kimi-k2.6", "kimi-k2.5", "kimi-k2.7-code"],
};

const customModelValue = "__custom__";
const providerLabels: Record<DiagnosisProvider, string> = {
  siliconflow: "硅基流动",
  deepseek: "DeepSeek",
  kimi: "Kimi",
};
const modelGroups = [
  { label: "智谱 AI", models: ["zai-org/GLM-5.2", "zai-org/GLM-4.5V"] },
  { label: "月之暗面", models: ["Pro/moonshotai/Kimi-K2.6"] },
  { label: "MiniMax", models: ["MiniMaxAI/MiniMax-M2.5"] },
  { label: "DeepSeek", models: ["deepseek-ai/DeepSeek-V3.2"] },
  {
    label: "通义千问",
    models: [
      "Qwen/Qwen3.6-27B",
      "Qwen/Qwen3.5-27B",
      "Qwen/Qwen3-8B",
      "Qwen/Qwen2.5-72B-Instruct",
    ],
  },
];
const defaultModelByProvider: Record<DiagnosisProvider, string> = {
  siliconflow: "Qwen/Qwen2.5-72B-Instruct",
  deepseek: "deepseek-v4-flash",
  kimi: "kimi-k2.6",
};

export function SettingsPanel(props: SettingsPanelProps) {
  const models =
    props.backend?.providers.find((item) => item.provider === props.provider)
      ?.models ?? defaultModels[props.provider];
  const isCustomModel = !models.includes(props.model);
  const defaultModel = defaultModelByProvider[props.provider];
  const selectedProviderSettings = props.backend?.providers.find(
    (item) => item.provider === props.provider,
  );

  return (
    <section className="task-panel" aria-labelledby="ai-settings-title">
      <p className="eyebrow">AI配置</p>
      <h2 id="ai-settings-title">AI 诊断连接</h2>
      <p>API Key 只保存在当前页面内存，后端不会返回、掩码或保存它。</p>
      <label>
        诊断模式
        <select
          aria-label="诊断服务商"
          value={props.mode === "mock" ? "mock" : props.provider}
          onChange={(event) => {
            const value = event.target.value;
            const nextProvider =
              value === "mock" ? "siliconflow" : (value as DiagnosisProvider);
            props.onModeChange(
              value === "mock" ? "mock" : (value as DiagnosisMode),
              value === "mock" ? undefined : (value as DiagnosisProvider),
            );
            props.onModelChange(defaultModelByProvider[nextProvider]);
          }}
        >
          <option value="mock">Mock（离线）</option>
          <option value="siliconflow">硅基流动</option>
          <option value="deepseek">DeepSeek</option>
          <option value="kimi">Kimi</option>
        </select>
      </label>
      {props.mode === "mock" ? (
        <p>当前为本地离线模式，不调用任何模型，也不需要配置模型。</p>
      ) : (
        <label>
          模型
          <select
            aria-label="模型"
            value={isCustomModel ? customModelValue : props.model}
            onChange={(event) => {
              if (event.target.value === customModelValue) {
                props.onModelChange("");
                return;
              }
              props.onModelChange(event.target.value);
            }}
          >
            {modelGroups.map((group) => {
              const groupModels = group.models.filter((model) =>
                models.includes(model),
              );
              if (!groupModels.length) return null;
              return (
                <optgroup key={group.label} label={group.label}>
                  {groupModels.map((model) => (
                    <option key={model} value={model}>
                      {model === defaultModel ? `默认模型：${model}` : model}
                    </option>
                  ))}
                </optgroup>
              );
            })}
            {models
              .filter(
                (model) =>
                  !modelGroups.some((group) => group.models.includes(model)),
              )
              .map((model) => (
                <option key={model} value={model}>
                  {model === defaultModel ? `默认模型：${model}` : model}
                </option>
              ))}
            <option value={customModelValue}>自定义模型</option>
          </select>
          {isCustomModel && (
            <input
              aria-label="自定义模型名称"
              placeholder="请输入模型完整标识"
              value={props.model}
              onChange={(event) => props.onModelChange(event.target.value)}
            />
          )}
        </label>
      )}
      <label>
        临时 API Key
        <input
          type="password"
          value={props.apiKey}
          onChange={(event) => props.onApiKeyChange(event.target.value)}
        />
      </label>
      <button type="button" disabled={props.testing} onClick={props.onTest}>
        {props.testing ? "正在测试连接…" : "测试 AI 连接"}
      </button>
      <p>
        会实际请求 {providerLabels[props.provider]} 模型，验证 API Key
        和模型是否可用。
      </p>
      <button
        type="button"
        disabled={props.testing || props.mode === "mock"}
        onClick={props.onLocalTest}
      >
        使用本地配置测试
      </button>
      <p>使用后端环境变量中的 Key 实际请求模型，不使用本页面临时 Key。</p>
      {props.mode === "mock" ? (
        <p>Mock 模式：无需 API Key。</p>
      ) : selectedProviderSettings ? (
        <p>
          当前 {providerLabels[props.provider]} Key 状态：
          {selectedProviderSettings.api_key_configured ? "已配置" : "未配置"}
        </p>
      ) : null}
      {props.message && (
        <p
          className={`connection-result ${
            props.message.startsWith("当前可用")
              ? "connection-result--success"
              : "connection-result--failure"
          }`}
          role="status"
        >
          {props.message}
        </p>
      )}
    </section>
  );
}
