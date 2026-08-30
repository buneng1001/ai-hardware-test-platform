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
  onLoad: () => void;
};

export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <section className="task-panel" aria-labelledby="ai-settings-title">
      <p className="eyebrow">设置</p>
      <h2 id="ai-settings-title">AI 诊断连接</h2>
      <p>API Key 只保存在当前页面内存，后端不会返回、掩码或保存它。</p>
      <label>
        诊断模式
        <select
          aria-label="诊断服务商"
          value={props.mode === "mock" ? "mock" : props.provider}
          onChange={(event) => {
            const value = event.target.value;
            props.onModeChange(
              value === "mock" ? "mock" : (value as DiagnosisMode),
              value === "mock" ? undefined : (value as DiagnosisProvider),
            );
          }}
        >
          <option value="mock">Mock（离线）</option>
          <option value="siliconflow">硅基流动</option>
          <option value="deepseek">DeepSeek</option>
          <option value="kimi">Kimi</option>
        </select>
      </label>
      <label>
        模型
        <input
          list="available-models"
          value={props.model}
          onChange={(event) => props.onModelChange(event.target.value)}
        />
        <datalist id="available-models">
          {(
            props.backend?.providers.find(
              (item) => item.provider === props.provider,
            )?.models ?? []
          ).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>
      <label>
        临时 API Key
        <input
          type="password"
          value={props.apiKey}
          onChange={(event) => props.onApiKeyChange(event.target.value)}
        />
      </label>
      <button type="button" disabled={props.testing} onClick={props.onTest}>
        {props.testing
          ? "正在测试连接…"
          : props.mode === "mock" || props.provider === "siliconflow"
            ? "测试硅基流动连接"
            : `测试 ${props.provider} 连接`}
      </button>
      <button type="button" onClick={props.onLoad}>
        读取后端配置状态
      </button>
      {props.backend && (
        <p>
          后端 Key 状态：
          {props.backend.api_key_configured ? "已配置" : "未配置"}
        </p>
      )}
      {props.message && <p role="status">{props.message}</p>}
    </section>
  );
}
