import type { RunRecord, RunStatus } from "./collectionTasksApi";
import { ManualCheckResultsPanel } from "./ManualCheckResultsPanel";

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
            <span>
              {artifact.path.split("/").at(-1)} ·{" "}
              {artifact.source === "actual_generated"
                ? "实际生成"
                : "虚拟时间模拟"}
            </span>
            <small> · SHA-256：{artifact.sha256.slice(0, 12)}…</small>
          </li>
        ))}
      </ul>
      {run.generation_metadata && (
        <p>
          时间线：
          {run.generation_metadata.timeline_source === "actual_generated"
            ? "实际生成"
            : "虚拟时间模拟"}
          ；请求
          {run.generation_metadata.requested_duration_seconds} 秒，真实媒体
          {run.generation_metadata.generated_duration_seconds} 秒；重复性指纹：
          {run.generation_metadata.reproducibility_fingerprint.slice(0, 12)}…
        </p>
      )}
      {run.generation_metadata && (
        <p>
          虚拟趋势：温度{" "}
          {run.generation_metadata.temperature_range_c.join(" → ")} °C；存储
          {run.generation_metadata.storage_range_mb.join(" → ")} MB
        </p>
      )}
      <section aria-labelledby="run-analysis-title">
        <h3 id="run-analysis-title">运行分析</h3>
        <h4>自动化检测结果</h4>
        <ul>
          {run.checks.map((check) => {
            const anomaly = check.anomaly_windows?.[0];
            return (
              <li key={check.name}>
                <p>{check.message}</p>
                {check.name === "video_frame_drop" &&
                  check.status === "failed" && (
                    <>
                      <p>
                        失败指标：预期 {check.metrics.expected_frames} 帧，实际{" "}
                        {check.metrics.actual_frames} 帧，缺失{" "}
                        {check.metrics.dropped_frames} 帧
                      </p>
                      {anomaly && (
                        <p>
                          异常时间窗口：第 {anomaly.channel} 路{" "}
                          {anomaly.start_s.toFixed(3)}～
                          {anomaly.end_s.toFixed(3)} 秒
                        </p>
                      )}
                      <p>
                        故障真值对照：
                        {check.truth_comparison === "matched"
                          ? "命中"
                          : "未命中"}
                      </p>
                    </>
                  )}
                {check.category === "imu" && check.status === "failed" && (
                  <>
                    {check.anomaly_windows.length > 0 && (
                      <p>
                        异常位置：
                        {check.anomaly_windows
                          .map((position) => `样本 #${position.sample_index}`)
                          .join("、")}
                      </p>
                    )}
                    {check.name === "imu_interval_distribution" && (
                      <p>
                        间隔分布：最小 {check.metrics.minimum_interval_ms}{" "}
                        ms，最大 {check.metrics.maximum_interval_ms} ms，平均{" "}
                        {check.metrics.mean_interval_ms} ms，P95{" "}
                        {check.metrics.p95_interval_ms} ms，异常{" "}
                        {check.metrics.outlier_count} 个
                      </p>
                    )}
                    {check.truth_comparison !== "not_applicable" && (
                      <p>
                        故障真值对照：
                        {check.truth_comparison === "matched"
                          ? "命中"
                          : "未命中"}
                      </p>
                    )}
                  </>
                )}
                {check.category === "storage" && (
                  <>
                    {check.name === "storage_premature_stop" && (
                      <p>
                        时长：请求 {check.metrics.requested_duration_s} 秒，实际{" "}
                        {check.metrics.actual_duration_s} 秒
                      </p>
                    )}
                    {check.name === "storage_exhaustion" && (
                      <p>
                        存储：阈值 {check.metrics.threshold_mb} MB，最低{" "}
                        {check.metrics.minimum_free_mb} MB
                      </p>
                    )}
                    {check.name === "storage_log_correlation" && (
                      <p>日志关联事件数：{check.metrics.matched_event_count}</p>
                    )}
                    {check.truth_comparison !== "not_applicable" && (
                      <p>
                        故障真值对照：
                        {check.truth_comparison === "matched"
                          ? "命中"
                          : "未命中"}
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <ManualCheckResultsPanel
          key={run.id}
          runId={run.id}
          initialResults={run.manual_check_results}
        />
      </section>
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
