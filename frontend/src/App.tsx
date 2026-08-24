import { useEffect, useState } from "react";

import {
  type CollectionTask,
  type CollectionTaskCommand,
  type RunRecord,
  cancelRun,
  createCollectionTask,
  executeCollectionTask,
  getRun,
  listCollectionTasks,
  rerun,
  reviewAlignment,
} from "./collectionTasksApi";
import { CollectionTaskForm } from "./CollectionTaskForm";
import { isTerminalRun, RunDetail } from "./RunDetail";

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

      {runError && <p role="alert">{runError}</p>}
      {selectedRun && (
        <RunDetail
          run={selectedRun}
          onCancel={() => void cancelSelectedRun()}
          onRerun={() => void rerunSelectedRun()}
          onReviewAlignment={(anchors) => void reviewSelectedAlignment(anchors)}
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
  fixed_offset: "固定偏移",
  linear_drift: "线性漂移",
} as const;
