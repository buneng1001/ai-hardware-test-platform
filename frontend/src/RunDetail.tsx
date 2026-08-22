import type { RunRecord, RunStatus } from "./collectionTasksApi";

const terminalRunStatuses = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const stageLabels: Record<string, string> = {
  queued: "排队",
  generating_data: "生成数据",
  running_checks: "执行检查",
  summarizing_results: "汇总结果",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
  interrupted: "异常中断",
};

const statusLabels: Record<RunStatus, string> = {
  queued: "排队中",
  generating_data: "正在生成数据",
  running_checks: "正在执行检查",
  summarizing_results: "正在汇总结果",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
  interrupted: "异常中断",
};

export function isTerminalRun(status: RunStatus): boolean {
  return terminalRunStatuses.has(status);
}

type RunDetailProps = {
  run: RunRecord;
  onCancel: () => void;
  onRerun: () => void;
};

export function RunDetail({ run, onCancel, onRerun }: RunDetailProps) {
  return (
    <section className="run-detail" aria-labelledby="run-detail-title">
      <p className="eyebrow">运行详情</p>
      <h2 id="run-detail-title">运行 #{run.id}</h2>
      <p className="run-status">{statusLabels[run.status]}</p>
      <p>
        进度：{run.events.length}/5（{run.events.length * 20}%）
      </p>
      <h3>阶段</h3>
      <p>{run.events.map((event) => stageLabels[event.stage]).join(" → ")}</p>
      <h3>产物</h3>
      <ul>
        {run.artifacts.map((artifact) => (
          <li key={artifact.path}>
            {artifact.path.split("/").at(-1)} · 实际生成
          </li>
        ))}
      </ul>
      <h3>基础检查</h3>
      <ul>
        {run.checks.map((check) => (
          <li key={check.name}>{check.message}</li>
        ))}
      </ul>
      {!isTerminalRun(run.status) && (
        <button type="button" onClick={onCancel}>
          取消运行
        </button>
      )}
      {isTerminalRun(run.status) && (
        <button type="button" onClick={onRerun}>
          重新执行
        </button>
      )}
    </section>
  );
}
