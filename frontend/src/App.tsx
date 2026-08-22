import { useEffect, useState } from "react";

import {
  type CollectionTask,
  type CollectionTaskCommand,
  type RunRecord,
  createCollectionTask,
  executeCollectionTask,
  listCollectionTasks,
} from "./collectionTasksApi";
import { CollectionTaskForm } from "./CollectionTaskForm";

type Health = {
  status: "ok";
  database: "ok";
};

type PageState = Health | "loading" | "unavailable";

export function App() {
  const [state, setState] = useState<PageState>("loading");
  const [tasks, setTasks] = useState<CollectionTask[] | null>(null);
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

      <section className="task-list" aria-labelledby="task-list-title">
        <p className="eyebrow">已保存任务</p>
        <h2 id="task-list-title">采集任务</h2>
        {tasks === null && <p role="status">正在加载采集任务…</p>}
        {tasks?.length === 0 && <p>还没有采集任务。</p>}
        {tasks?.map((task) => (
          <article className="task-card" key={task.id}>
            <h3>{task.name}</h3>
            <p>
              {{ quick: "快速", standard: "标准", custom: "自定义" }[task.mode]}{" "}
              · 正常采集 · 草稿
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

      {runError && <p role="alert">{runError}</p>}
      {selectedRun && (
        <section className="run-detail" aria-labelledby="run-detail-title">
          <p className="eyebrow">运行详情</p>
          <h2 id="run-detail-title">运行 #{selectedRun.id}</h2>
          <p className="run-status">
            {selectedRun.status === "completed" ? "已完成" : "执行失败"}
          </p>
          <p>
            进度：{selectedRun.events.length}/5（
            {selectedRun.events.length * 20}%）
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
                <span>
                  {artifact.path.split("/").at(-1)} {" · "}
                  {artifact.source === "actual_generated"
                    ? "实际生成"
                    : "虚拟时间模拟"}
                </span>
                <small> · SHA-256：{artifact.sha256.slice(0, 12)}…</small>
              </li>
            ))}
          </ul>
          {selectedRun.generation_metadata && (
            <p>
              时间线：
              {selectedRun.generation_metadata.timeline_source ===
              "actual_generated"
                ? "实际生成"
                : "虚拟时间模拟"}
              ；请求{" "}
              {selectedRun.generation_metadata.requested_duration_seconds}{" "}
              秒，真实媒体
              {selectedRun.generation_metadata.generated_duration_seconds}{" "}
              秒；重复性指纹：
              {selectedRun.generation_metadata.reproducibility_fingerprint.slice(
                0,
                12,
              )}
              …
            </p>
          )}
          {selectedRun.generation_metadata && (
            <p>
              虚拟趋势：温度{" "}
              {selectedRun.generation_metadata.temperature_range_c.join(" → ")}{" "}
              °C；存储
              {selectedRun.generation_metadata.storage_range_mb.join(" → ")} MB
            </p>
          )}
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
