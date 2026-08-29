import { useEffect, useState } from "react";

import {
  type CollectionTask,
  type CollectionTaskCommand,
  type AiSettings,
  type DiagnosisMode,
  type DiagnosisProvider,
  type RunRecord,
  cancelRun,
  createCollectionTask,
  executeCollectionTask,
  getRun,
  listCollectionTasks,
  listSavedTasks,
  deleteCollectionTask,
  archiveCollectionTask,
  type SavedTaskPage,
  rerun,
  reviewAlignment,
  getAiSettings,
  testAiConnection,
} from "./collectionTasksApi";
import { CollectionTaskForm } from "./CollectionTaskForm";
import { DashboardPanel } from "./DashboardPanel";
import { isTerminalRun, RunDetail } from "./RunDetail";

type Health = {
  status: "ok";
  database: "ok";
};

type PageState = Health | "loading" | "unavailable";
type PageKey =
  | "all"
  | "dashboard"
  | "new-task"
  | "import"
  | "saved"
  | "run-detail"
  | "settings";

export function App() {
  const [state, setState] = useState<PageState>("loading");
  const [tasks, setTasks] = useState<CollectionTask[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [executingTaskId, setExecutingTaskId] = useState<number | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [diagnosisMode, setDiagnosisMode] = useState<DiagnosisMode>("mock");
  const [diagnosisProvider, setDiagnosisProvider] =
    useState<DiagnosisProvider>("siliconflow");
  const [diagnosisModel, setDiagnosisModel] = useState(
    "Qwen/Qwen2.5-72B-Instruct",
  );
  const [temporaryApiKey, setTemporaryApiKey] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [testingConnection, setTestingConnection] = useState(false);
  const [backendSettings, setBackendSettings] = useState<AiSettings | null>(
    null,
  );
  const [activePage, setActivePage] = useState<PageKey>("all");
  const [savedTasks, setSavedTasks] = useState<SavedTaskPage | null>(null);
  const [savedTaskError, setSavedTaskError] = useState<string | null>(null);
  const [savedTaskPage, setSavedTaskPage] = useState(1);
  const [savedTaskFilters, setSavedTaskFilters] = useState<{
    source?: "synthetic_generated" | "imported_actual_data";
    execution_status?: "never_executed" | "has_runs";
    archived?: boolean;
  }>({});

  useEffect(() => {
    const loadPage = async () => {
      try {
        const response = await fetch("/api/health");
        if (!response.ok) {
          setState("unavailable");
          return;
        }
        setState((await response.json()) as Health);
      } catch {
        // 状态页只展示安全的可用性结论，不泄露底层连接或路径信息。
        console.error("健康状态请求失败");
        setState("unavailable");
      }

      try {
        setTasks(await listCollectionTasks());
      } catch {
        console.error("采集任务列表加载失败");
        setTasks([]);
      }
    };

    void loadPage();
  }, []);

  useEffect(() => {
    if (!selectedRun || isTerminalRun(selectedRun.status)) return;
    const timeout = window.setTimeout(async () => {
      try {
        setSelectedRun(await getRun(selectedRun.id));
      } catch {
        console.error("运行记录刷新失败");
        setRunError("运行状态刷新失败，请稍后重试");
      }
    }, 50);
    return () => window.clearTimeout(timeout);
  }, [selectedRun]);

  const submitTask = async (command: CollectionTaskCommand) => {
    setSaving(true);
    setFormError(null);
    try {
      const createdTask = await createCollectionTask(command);
      setTasks((currentTasks) => [createdTask, ...(currentTasks ?? [])]);
      return true;
    } catch {
      console.error("采集任务保存失败");
      setFormError("采集任务保存失败，请检查输入后重试");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const executeTask = async (taskId: number) => {
    setExecutingTaskId(taskId);
    setActivePage("run-detail");
    setRunError(null);
    try {
      setSelectedRun(await executeCollectionTask(taskId));
    } catch {
      console.error("采集任务执行失败");
      setRunError("采集任务执行失败，请稍后重试");
    } finally {
      setExecutingTaskId(null);
    }
  };

  const cancelSelectedRun = async () => {
    if (!selectedRun) return;
    try {
      setSelectedRun(await cancelRun(selectedRun.id));
    } catch {
      setRunError("取消运行失败，请刷新后重试");
    }
  };

  const rerunSelectedRun = async () => {
    if (!selectedRun) return;
    try {
      setSelectedRun(await rerun(selectedRun.id));
    } catch {
      setRunError("重新执行失败，请稍后重试");
    }
  };

  const reviewSelectedAlignment = async (
    anchors: Parameters<typeof reviewAlignment>[1],
  ) => {
    if (!selectedRun) return;
    try {
      setSelectedRun(await reviewAlignment(selectedRun.id, anchors));
    } catch (error) {
      const message = error instanceof Error ? error.message : "锚点复核失败";
      setRunError(`锚点复核失败：${message}`);
    }
  };

  const checkAiConnection = async () => {
    setConnectionMessage(null);
    setTestingConnection(true);
    try {
      const result = await testAiConnection(
        diagnosisModel,
        temporaryApiKey,
        diagnosisProvider,
      );
      setConnectionMessage(
        result.ok
          ? result.provider === "siliconflow"
            ? result.message
            : `${result.provider}/${result.model}：${result.message}`
          : `连接失败：${result.message}`,
      );
    } catch {
      setConnectionMessage("连接测试请求失败，请检查后端状态");
    } finally {
      setTestingConnection(false);
    }
  };

  const loadBackendSettings = async () => {
    try {
      setBackendSettings(await getAiSettings());
    } catch {
      setConnectionMessage("后端设置状态读取失败，请检查服务状态");
    }
  };

  const openDashboardRun = async (runId: number) => {
    setActivePage("run-detail");
    try {
      setSelectedRun(await getRun(runId));
    } catch {
      setRunError("运行详情加载失败，请稍后重试");
    }
  };

  const refreshSavedTasks = async (
    page = savedTaskPage,
    filters = savedTaskFilters,
  ) => {
    setSavedTaskError(null);
    try {
      setSavedTasks(await listSavedTasks(page, filters));
      setSavedTaskPage(page);
    } catch {
      console.error("已保存任务加载失败");
      setSavedTaskError("已保存任务加载失败，请稍后重试");
    }
  };

  const removeSavedTask = async (taskId: number) => {
    try {
      await deleteCollectionTask(taskId);
      await refreshSavedTasks();
    } catch (error) {
      const message = error instanceof Error ? error.message : "任务删除失败";
      setSavedTaskError(
        message.includes("只能归档") ? message : "任务删除失败，请刷新后重试",
      );
    }
  };

  const archiveSavedTask = async (taskId: number) => {
    try {
      await archiveCollectionTask(taskId);
      await refreshSavedTasks();
    } catch {
      setSavedTaskError("任务归档失败，请刷新后重试");
    }
  };

  const navigate = (page: PageKey) => {
    setActivePage(page);
    if (page === "saved") void refreshSavedTasks();
  };

  const isPageVisible = (page: PageKey) =>
    activePage === "all" || activePage === page;

  return (
    <main className="status-page">
      <nav aria-label="主导航" className="topbar">
        {(
          [
            ["dashboard", "仪表盘"],
            ["new-task", "新建任务"],
            ["import", "根据导入生成"],
            ["saved", "已保存任务"],
            ["run-detail", "运行详情"],
          ] as const
        ).map(([page, label]) => (
          <button
            key={page}
            type="button"
            aria-current={activePage === page ? "page" : undefined}
            onClick={() => navigate(page)}
          >
            {label}
          </button>
        ))}
        <button type="button" onClick={() => navigate("settings")}>
          设置
        </button>
      </nav>
      <p className="eyebrow">本地运行基线</p>
      <h1>智能硬件测试执行与诊断平台</h1>
      {state === "loading" && <p role="status">正在检查服务状态…</p>}
      {state === "unavailable" && <p role="alert">服务暂不可用</p>}
      {typeof state === "object" && (
        <section className="status-card" aria-label="平台状态">
          <p>服务运行正常</p>
          <p>SQLite 可用</p>
        </section>
      )}

      <div hidden={!isPageVisible("dashboard")}>
        <DashboardPanel onOpenRun={(runId) => void openDashboardRun(runId)} />
      </div>

      <section
        hidden={!isPageVisible("import")}
        className="task-panel"
        aria-labelledby="import-task-title"
      >
        <p className="eyebrow">根据导入生成</p>
        <h2 id="import-task-title">根据导入生成</h2>
        <p>实际测试 ZIP 导入将在独立流程中校验后加入任务列表。</p>
        <p role="status">导入能力尚未在本 ticket 开放。</p>
      </section>

      <section
        hidden={!isPageVisible("settings")}
        className="task-panel"
        aria-labelledby="ai-settings-title"
      >
        <p className="eyebrow">设置</p>
        <h2 id="ai-settings-title">AI 诊断连接</h2>
        <p>API Key 只保存在当前页面内存，后端不会返回、掩码或保存它。</p>
        <label>
          诊断模式
          <select
            aria-label="诊断服务商"
            value={diagnosisMode === "mock" ? "mock" : diagnosisProvider}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "mock") setDiagnosisMode("mock");
              else {
                setDiagnosisProvider(value as DiagnosisProvider);
                setDiagnosisMode(value as DiagnosisMode);
              }
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
            value={diagnosisModel}
            onChange={(event) => setDiagnosisModel(event.target.value)}
          />
          <datalist id="available-models">
            {(
              backendSettings?.providers.find(
                (item) => item.provider === diagnosisProvider,
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
            value={temporaryApiKey}
            onChange={(event) => setTemporaryApiKey(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={testingConnection}
          onClick={() => void checkAiConnection()}
        >
          {testingConnection
            ? "正在测试连接…"
            : diagnosisMode === "mock" || diagnosisProvider === "siliconflow"
              ? "测试硅基流动连接"
              : `测试 ${diagnosisProvider} 连接`}
        </button>
        <button type="button" onClick={() => void loadBackendSettings()}>
          读取后端配置状态
        </button>
        {backendSettings && (
          <p>
            后端 Key 状态：
            {backendSettings.api_key_configured ? "已配置" : "未配置"}
          </p>
        )}
        {connectionMessage && <p role="status">{connectionMessage}</p>}
      </section>

      <section
        hidden={!isPageVisible("new-task")}
        className="task-panel"
        aria-labelledby="new-task-title"
      >
        <div>
          <p className="eyebrow">新建任务</p>
          <h2 id="new-task-title">配置正常采集</h2>
          <p>
            选择快速、标准或自定义模式，安全生成 1～4 路视频及配套传感器数据。
          </p>
        </div>
        <CollectionTaskForm
          disabled={tasks === null}
          saving={saving}
          onSubmit={submitTask}
        />
        {formError && <p role="alert">{formError}</p>}
      </section>

      <section
        hidden={!isPageVisible("saved")}
        className="task-list"
        aria-labelledby="task-list-title"
      >
        <p className="eyebrow">已保存任务</p>
        <h2 id="task-list-title">采集任务</h2>
        {tasks === null && <p role="status">正在加载采集任务…</p>}
        {tasks?.length === 0 && <p>还没有采集任务。</p>}
        {tasks?.map((task) => (
          <article className="task-card" key={task.id}>
            <h3>{task.name}</h3>
            <p>
              {{ quick: "快速", standard: "标准", custom: "自定义" }[task.mode]}{" "}
              · {scenarioLabels[task.scenario]} · 草稿
            </p>
            <button
              type="button"
              disabled={executingTaskId !== null}
              onClick={() => void executeTask(task.id)}
            >
              {executingTaskId === task.id ? "正在执行…" : "执行任务"}
            </button>
          </article>
        ))}
      </section>

      <section
        hidden={!isPageVisible("saved")}
        className="task-list"
        aria-labelledby="saved-task-title"
      >
        <p className="eyebrow">已保存任务</p>
        <h2 id="saved-task-title">任务生命周期</h2>
        <p>列表按来源、执行状态和归档状态提供筛选；每页最多 10 条。</p>
        <div className="configuration-grid" aria-label="已保存任务筛选">
          <label>
            来源
            <select
              value={savedTaskFilters.source ?? ""}
              onChange={(event) => {
                const source = event.target
                  .value as typeof savedTaskFilters.source;
                const next = {
                  ...savedTaskFilters,
                  source: source || undefined,
                };
                setSavedTaskFilters(next);
                void refreshSavedTasks(1, next);
              }}
            >
              <option value="">全部来源</option>
              <option value="synthetic_generated">合成数据</option>
              <option value="imported_actual_data">导入实际数据</option>
            </select>
          </label>
          <label>
            执行状态
            <select
              value={savedTaskFilters.execution_status ?? ""}
              onChange={(event) => {
                const executionStatus = event.target
                  .value as typeof savedTaskFilters.execution_status;
                const next = {
                  ...savedTaskFilters,
                  execution_status: executionStatus || undefined,
                };
                setSavedTaskFilters(next);
                void refreshSavedTasks(1, next);
              }}
            >
              <option value="">全部执行状态</option>
              <option value="never_executed">未执行</option>
              <option value="has_runs">已有运行</option>
            </select>
          </label>
          <label>
            归档状态
            <select
              value={
                savedTaskFilters.archived === undefined
                  ? ""
                  : String(savedTaskFilters.archived)
              }
              onChange={(event) => {
                const archived =
                  event.target.value === ""
                    ? undefined
                    : event.target.value === "true";
                const next = { ...savedTaskFilters, archived };
                setSavedTaskFilters(next);
                void refreshSavedTasks(1, next);
              }}
            >
              <option value="">全部归档状态</option>
              <option value="false">未归档</option>
              <option value="true">已归档</option>
            </select>
          </label>
        </div>
        <button type="button" onClick={() => void refreshSavedTasks()}>
          刷新已保存任务
        </button>
        {savedTaskError && <p role="alert">{savedTaskError}</p>}
        {savedTasks && (
          <>
            <p>
              第 {savedTasks.page} 页 · 共 {savedTasks.total} 条
            </p>
            {savedTasks.items.map((task) => (
              <article className="task-card" key={task.id}>
                <h3>{task.name}</h3>
                <p>
                  来源：
                  {task.source === "synthetic_generated"
                    ? "合成数据"
                    : "导入实际数据"}{" "}
                  ·
                  {task.execution_status === "has_runs" ? "已有运行" : "未执行"}{" "}
                  ·{task.archived ? "已归档" : "未归档"}
                </p>
                {task.execution_status === "has_runs" ? (
                  <button
                    type="button"
                    onClick={() => void archiveSavedTask(task.id)}
                  >
                    归档任务 {task.name}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void removeSavedTask(task.id)}
                  >
                    删除任务 {task.name}
                  </button>
                )}
              </article>
            ))}
            <div className="pagination" aria-label="已保存任务分页">
              <button
                type="button"
                disabled={savedTasks.page <= 1}
                onClick={() => void refreshSavedTasks(savedTasks.page - 1)}
              >
                上一页
              </button>
              <button
                type="button"
                disabled={
                  savedTasks.page * savedTasks.page_size >= savedTasks.total
                }
                onClick={() => void refreshSavedTasks(savedTasks.page + 1)}
              >
                下一页
              </button>
            </div>
          </>
        )}
      </section>

      {isPageVisible("run-detail") && runError && (
        <p role="alert">{runError}</p>
      )}
      {isPageVisible("run-detail") && selectedRun && (
        <RunDetail
          run={selectedRun}
          onCancel={() => void cancelSelectedRun()}
          onRerun={() => void rerunSelectedRun()}
          onReviewAlignment={(anchors) => void reviewSelectedAlignment(anchors)}
          diagnosisMode={diagnosisMode}
          diagnosisProvider={diagnosisProvider}
          diagnosisModel={diagnosisModel}
          temporaryApiKey={temporaryApiKey}
        />
      )}
    </main>
  );
}

const scenarioLabels = {
  normal: "正常采集",
  video_drop: "单路视频掉帧",
  imu_anomaly: "IMU 异常",
  storage_exhaustion: "存储不足",
  temperature_combination: "温升关联组合故障",
  fixed_offset: "固定偏移",
  linear_drift: "线性漂移",
} as const;
