import type { CollectionTask } from "./collectionTasksApi";

const scenarioLabels = {
  normal: "正常采集",
  video_drop: "单路视频掉帧",
  imu_anomaly: "IMU 异常",
  storage_exhaustion: "存储不足",
  temperature_combination: "温升关联组合故障",
  fixed_offset: "固定偏移",
  linear_drift: "线性漂移",
} as const;

type TaskListPanelProps = {
  tasks: CollectionTask[] | null;
  executingTaskId: number | null;
  onExecute: (taskId: number) => void;
};

export function TaskListPanel({
  tasks,
  executingTaskId,
  onExecute,
}: TaskListPanelProps) {
  return (
    <section className="task-list" aria-labelledby="task-list-title">
      <p className="eyebrow">已保存任务</p>
      <h2 id="task-list-title">采集任务</h2>
      {tasks === null && <p role="status">正在加载采集任务…</p>}
      {tasks?.length === 0 && <p>还没有采集任务。</p>}
      {tasks?.map((task) => (
        <article className="task-card" key={task.id}>
          <h3>{task.name}</h3>
          <p>
            {{ quick: "快速", standard: "标准", custom: "自定义" }[task.mode]} ·{" "}
            {scenarioLabels[task.scenario]} · 草稿
          </p>
          <button
            type="button"
            disabled={executingTaskId !== null}
            onClick={() => onExecute(task.id)}
          >
            {executingTaskId === task.id ? "正在执行…" : "执行任务"}
          </button>
        </article>
      ))}
    </section>
  );
}
