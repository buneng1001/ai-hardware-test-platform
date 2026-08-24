import { useEffect, useState } from "react";

import type {
  AlignmentReviewItem,
  RunRecord,
  RunStatus,
} from "./collectionTasksApi";
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
  onReviewAlignment: (anchors: AlignmentReviewItem[]) => void;
};

export function RunDetail({
  run,
  onCancel,
  onRerun,
  onReviewAlignment,
}: RunDetailProps) {
  const [anchorDrafts, setAnchorDrafts] = useState<
    Record<string, AlignmentReviewItem>
  >({});

  useEffect(() => {
    const details = run.alignment_result?.anchor_details ?? [];
    setAnchorDrafts(
      Object.fromEntries(
        details.map((anchor) => [
          anchor.id,
          {
            anchor_id: anchor.id,
            reviewed_time_s: anchor.reviewed_time_s ?? anchor.detected_time_s,
            included: anchor.included,
          },
        ]),
      ),
    );
  }, [run.id, run.alignment_result?.review_revision]);

  const submitAnchorReview = () => {
    onReviewAlignment(Object.values(anchorDrafts));
  };

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
        {run.alignment_result && (
          <>
            <h4>时间对齐结果</h4>
            <p>
              参考时钟：{run.alignment_result.reference_channel} · 方法：
              {run.alignment_result.method === "linear_drift_regression"
                ? "多事件线性漂移回归"
                : "固定偏移锚点"}
            </p>
            <p>估计校正量（秒）：</p>
            <ul>
              {Object.entries(run.alignment_result.parameters).map(
                ([channel, offset]) => (
                  <li key={channel}>
                    {channel}: {offset.toFixed(3)} s
                  </li>
                ),
              )}
            </ul>
            {run.alignment_result.method === "linear_drift_regression" && (
              <>
                <p>估计漂移率（秒/秒）：</p>
                <ul>
                  {Object.entries(run.alignment_result.drift_rates_s_per_s).map(
                    ([channel, rate]) => (
                      <li key={channel}>
                        {channel}: {rate.toFixed(6)}
                      </li>
                    ),
                  )}
                </ul>
                <p>共同事件残差趋势（毫秒）：</p>
                <ul>
                  {Object.entries(run.alignment_result.trend).map(
                    ([channel, values]) => (
                      <li key={channel}>
                        {channel}:{" "}
                        {values.map((value) => value.toFixed(3)).join(" → ")}
                      </li>
                    ),
                  )}
                </ul>
              </>
            )}
            <p>对齐前指标：</p>
            <ul>
              {Object.entries(run.alignment_result.pre_alignment).map(
                ([channel, metrics]) => (
                  <li key={channel}>
                    {channel}：偏移 {metrics.offset_s.toFixed(3)} s，抖动{" "}
                    {metrics.jitter_ms.toFixed(3)} ms
                    {run.alignment_result?.method ===
                      "linear_drift_regression" &&
                      ", 漂移率 " +
                        (metrics.drift_s_per_s ?? 0).toFixed(6) +
                        " s/s"}
                  </li>
                ),
              )}
            </ul>
            <p>对齐后残差：</p>
            <ul>
              {Object.entries(run.alignment_result.post_alignment).map(
                ([channel, metrics]) => (
                  <li key={channel}>
                    {channel}：最大 {metrics.max_residual_ms.toFixed(3)}{" "}
                    ms，平均 {metrics.mean_residual_ms.toFixed(3)} ms，P95{" "}
                    {metrics.p95_residual_ms.toFixed(3)} ms
                  </li>
                ),
              )}
            </ul>
            <p>
              故障真值对照：
              {run.alignment_result.truth_comparison === "matched"
                ? "命中"
                : run.alignment_result.truth_comparison === "missed"
                  ? "未命中"
                  : "不适用"}
            </p>
            <h4>跨模态锚点复核</h4>
            <p>锚点复核版本：{run.alignment_result.review_revision}</p>
            <p>自动识别结果保留在“检测时间”，复核时间只用于重新计算对齐。</p>
            <ul>
              {run.alignment_result.anchor_details.map((anchor) => {
                const draft = anchorDrafts[anchor.id];
                return (
                  <li key={anchor.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft?.included ?? anchor.included}
                        onChange={(event) =>
                          setAnchorDrafts((current) => ({
                            ...current,
                            [anchor.id]: {
                              ...(current[anchor.id] ?? {
                                anchor_id: anchor.id,
                                reviewed_time_s: anchor.detected_time_s,
                              }),
                              included: event.target.checked,
                            },
                          }))
                        }
                      />
                      使用 {anchor.id}（
                      {anchor.source === "imu_peak" ? "IMU 冲击" : "视频闪光"}）
                    </label>
                    <span>
                      ，检测 {anchor.detected_time_s.toFixed(3)} s，复核{" "}
                    </span>
                    <input
                      aria-label={`${anchor.id} 复核时间`}
                      type="number"
                      step="0.001"
                      min="0"
                      value={draft?.reviewed_time_s ?? anchor.detected_time_s}
                      onChange={(event) =>
                        setAnchorDrafts((current) => ({
                          ...current,
                          [anchor.id]: {
                            ...(current[anchor.id] ?? {
                              anchor_id: anchor.id,
                              included: anchor.included,
                            }),
                            reviewed_time_s: Number(event.target.value),
                          },
                        }))
                      }
                    />
                    <span> s</span>
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={submitAnchorReview}>
              应用锚点复核
            </button>
            <h4>画面内容同步（独立评价）</h4>
            <p>
              状态：
              {run.alignment_result.content_sync.status === "passed"
                ? "通过"
                : run.alignment_result.content_sync.status === "failed"
                  ? "失败"
                  : "降级"}
              ；{run.alignment_result.content_sync.message}
            </p>
            <p>
              视频事件 {run.alignment_result.content_sync.video_event_count}{" "}
              个，IMU 事件 {run.alignment_result.content_sync.imu_event_count}{" "}
              个，按序对应{" "}
              {run.alignment_result.content_sync.matched_event_count} 个。
            </p>
          </>
        )}
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
