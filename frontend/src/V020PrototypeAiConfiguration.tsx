import {
  prototypeAiProviders as providers,
  type PrototypeAiProviderKey as ProviderKey,
} from "./V020PrototypeAiModels";
import { usePrototypeAiConfiguration } from "./usePrototypeAiConfiguration";

export function PrototypeAiConfiguration({ onSkip }: { onSkip: () => void }) {
  const {
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
    canUseTemporaryApi,
    changeProvider,
    changeTemporaryKey,
    changeRememberTemporaryKey,
    clearTemporaryKey,
    chooseAccessMode,
    validateConnectionConfiguration,
    refreshModelCatalog,
  } = usePrototypeAiConfiguration();

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

        <div className="prototype-ai-field">
          <div className="prototype-ai-model-heading">
            <span className="prototype-ai-field-label">
              <span aria-hidden="true">▣</span> 模型
            </span>
            <button
              className="prototype-ai-refresh-models"
              type="button"
              aria-label="刷新可用模型"
              onClick={refreshModelCatalog}
              disabled={loadingAction !== null}
            >
              ↻ {loadingAction === "catalog" ? "正在刷新…" : "刷新可用模型"}
            </button>
          </div>
          <select
            aria-label="模型"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            {availableModels.map((modelOption) => (
              <option key={modelOption.id} value={modelOption.id}>
                {modelOption.label}
                {modelOption.availability === "candidate"
                  ? " · 待实时校验"
                  : ""}
              </option>
            ))}
          </select>
          <small>内置目录仅供选择，连接时以服务商实时返回为准</small>
          {catalogMessage && (
            <small className="prototype-ai-catalog-feedback" role="status">
              {catalogMessage}
            </small>
          )}
        </div>

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
          使用后端配置接入
        </button>
      </div>
      <button
        className="prototype-ai-test"
        type="button"
        onClick={validateConnectionConfiguration}
        disabled={loadingAction !== null}
      >
        {loadingAction === "test" ? "正在测试…" : "AI 连接测试"}
      </button>
      {connectionMessage && (
        <p
          className={`prototype-ai-feedback${connectionSucceeded === false ? " prototype-ai-feedback-error" : ""}`}
          role={connectionSucceeded === false ? "alert" : "status"}
        >
          {connectionMessage}
        </p>
      )}
      <button className="prototype-ai-skip" type="button" onClick={onSkip}>
        暂不配置，进入平台
      </button>
    </section>
  );
}
