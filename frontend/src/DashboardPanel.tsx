import { useState } from "react";

import { getDashboard, type Dashboard } from "./dashboardApi";

type DashboardPanelProps = {
  onOpenRun: (runId: number) => void;
};

export function DashboardPanel({ onOpenRun }: DashboardPanelProps) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      setDashboard(await getDashboard());
    } catch {
      console.error("仪表盘加载失败");
      setError("仪表盘加载失败，请稍后重试");
    }
  };

  return (
    <section className="task-panel" aria-labelledby="dashboard-title">
      <p className="eyebrow">仪表盘</p>
      <h2 id="dashboard-title">运行与 AI 评估摘要</h2>
      <p>
        AI 评估是辅助判断，Schema 通过不等于诊断正确，也不是检测结果或根因证明。
      </p>
      <button type="button" onClick={() => void refresh()}>
        刷新仪表盘
      </button>
      {error && <p role="alert">{error}</p>}
      {dashboard && (
        <div aria-label="仪表盘摘要">
          <p>
            运行 {dashboard.run_statistics.total} 次 · 已完成{" "}
            {dashboard.run_statistics.completed} 次 · 失败{" "}
            {dashboard.run_statistics.failed} 次
          </p>
          <p>
            诊断：完成 {dashboard.diagnosis_status_counts.completed ?? 0}{" "}
            次，失败 {dashboard.diagnosis_status_counts.failed ?? 0} 次
          </p>
          <p>
            AI 评估：命中 {dashboard.evaluation_summary.hit_count}，漏判{" "}
            {dashboard.evaluation_summary.missed_count}，无证据推测{" "}
            {dashboard.evaluation_summary.unsupported_speculation_count}
          </p>
          <h3>近期失败</h3>
          {dashboard.recent_failures.length === 0 && <p>暂无失败运行。</p>}
          <ul>
            {dashboard.recent_failures.map((failure) => (
              <li key={failure.run_id}>
                <button type="button" onClick={() => onOpenRun(failure.run_id)}>
                  {failure.task_name} · 运行 #{failure.run_id} ·{" "}
                  {failure.scenario} · 失败检查 {failure.failed_check_count}
                </button>
                <span>
                  {failure.latest_diagnosis_status
                    ? ` · 诊断${failure.latest_diagnosis_status}`
                    : " · 尚未诊断"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
