import { useEffect, useState } from "react";

import {
  type CollectionTask,
  createQuickNormalTask,
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
          <p>固定使用快速模式和正常采集场景，执行能力将在后续 ticket 接入。</p>
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
          </article>
        ))}
      </section>
    </main>
  );
}
