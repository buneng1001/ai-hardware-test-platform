import { useEffect, useState } from "react";

import {
  type CollectionTask,
  type RunRecord,
  createQuickNormalTask,
  executeCollectionTask,
  listCollectionTasks,
} from "./collectionTasksApi";

type Health = {
  status: "ok";
  database: "ok";
};

type PageState = Health | "loading" | "unavailable";

export function App() {
  const [state, setState] = useState<PageState>("loading");
  const [tasks, setTasks] = useState<CollectionTask[] | null>(null);
  const [taskName, setTaskName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [executingTaskId, setExecutingTaskId] = useState<number | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

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

  const submitTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = taskName.trim();
    if (!normalizedName) {
      setFormError("请输入任务名称");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const createdTask = await createQuickNormalTask(normalizedName);
      setTasks((currentTasks) => [createdTask, ...(currentTasks ?? [])]);
      setTaskName("");
    } catch {
      console.error("采集任务保存失败");
      setFormError("采集任务保存失败，请检查输入后重试");
    } finally {
      setSaving(false);
    }
  };

  const executeTask = async (taskId: number) => {
    setExecutingTaskId(taskId);
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

  const stageLabels: Record<string, string> = {
    queued: "排队",
    generating_data: "生成数据",
    running_checks: "执行检查",
    summarizing_results: "汇总结果",
    completed: "已完成",
  };

  return (
    <main className="status-page">
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

      <section className="task-panel" aria-labelledby="new-task-title">
        <div>
          <p className="eyebrow">新建任务</p>
          <h2 id="new-task-title">快速正常采集</h2>
          <p>固定使用快速模式和正常采集场景，生成一路短视频及配套数据。</p>
        </div>
        <form onSubmit={submitTask}>
          <label htmlFor="task-name">任务名称</label>
          <input
            id="task-name"
            maxLength={80}
            value={taskName}
            onChange={(event) => setTaskName(event.target.value)}
          />
          <dl className="task-contract">
            <div>
              <dt>模式</dt>
              <dd>快速</dd>
            </div>
            <div>
              <dt>场景</dt>
              <dd>正常采集</dd>
            </div>
          </dl>
          {formError && <p role="alert">{formError}</p>}
          <button type="submit" disabled={saving || tasks === null}>
            {saving ? "正在保存…" : "保存采集任务"}
          </button>
        </form>
      </section>

      <section className="task-list" aria-labelledby="task-list-title">
        <p className="eyebrow">已保存任务</p>
        <h2 id="task-list-title">采集任务</h2>
        {tasks === null && <p role="status">正在加载采集任务…</p>}
        {tasks?.length === 0 && <p>还没有采集任务。</p>}
        {tasks?.map((task) => (
          <article className="task-card" key={task.id}>
            <h3>{task.name}</h3>
            <p>快速 · 正常采集 · 草稿</p>
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

      {runError && <p role="alert">{runError}</p>}
      {selectedRun && (
        <section className="run-detail" aria-labelledby="run-detail-title">
          <p className="eyebrow">运行详情</p>
          <h2 id="run-detail-title">运行 #{selectedRun.id}</h2>
          <p className="run-status">
            {selectedRun.status === "completed" ? "已完成" : "执行失败"}
          </p>
          <h3>阶段</h3>
          <p>
            {selectedRun.events
              .map((event) => stageLabels[event.stage])
              .join(" → ")}
          </p>
          <h3>产物</h3>
          <ul>
            {selectedRun.artifacts.map((artifact) => (
              <li key={artifact.path}>
                {artifact.path.split("/").at(-1)} · 实际生成
              </li>
            ))}
          </ul>
          <h3>基础检查</h3>
          <ul>
            {selectedRun.checks.map((check) => (
              <li key={check.name}>{check.message}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
