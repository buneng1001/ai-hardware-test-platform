import { useEffect, useState } from "react";

import type {
  AlignmentReviewItem,
  DiagnosisMode,
  DiagnosisRun,
  RunRecord,
  RunStatus,
} from "./collectionTasksApi";
import { createDiagnosis, listDiagnoses } from "./collectionTasksApi";
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
  diagnosisMode: DiagnosisMode;
  diagnosisModel: string;
  temporaryApiKey: string;
};

export function RunDetail({
  run,
  onCancel,
  onRerun,
  onReviewAlignment,
  diagnosisMode,
  diagnosisModel,
  temporaryApiKey,
}: RunDetailProps) {
  const [anchorDrafts, setAnchorDrafts] = useState<
    Record<string, AlignmentReviewItem>
  >({});
  const [diagnosis, setDiagnosis] = useState<DiagnosisRun | null>(null);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);

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

  const generateDiagnosis = async () => {
    setDiagnosisError(null);
    try {
      setDiagnosis(
        await createDiagnosis(
          run.id,
          diagnosisMode,
          diagnosisModel,
          temporaryApiKey,
        ),
      );
    } catch {
      console.error("结构化诊断生成失败");
      setDiagnosisError("结构化诊断生成失败，请查看诊断运行状态");
    }
  };

  const loadDiagnosisHistory = async () => {
    try {
      const history = await listDiagnoses(run.id);
      setDiagnosis(history.at(-1) ?? null);
    } catch {
      console.error("诊断历史加载失败");
      setDiagnosisError("诊断状态加载失败，请稍后重试");
    }
  };

  const submitAnchorReview = () => {
    onReviewAlignment(Object.values(anchorDrafts));
  };

  return (
    <section className="run-detail" aria-labelledby="run-detail-title">
      <p className="eyebrow">运行详情</p>
      <h2 id="run-detail-title">运行 #{run.id}</h2>
      <p>
        任务：{run.task_name || `任务 #${run.collection_task_id}`} ·
        任务内执行序号：
        {run.task_execution_number ?? 1} · 内部运行 ID：{run.id}
      </p>
      <p>
        队列位置：{run.queue_position ?? "当前执行器或已结束"} · 阶段状态：
        {statusLabels[run.stage_status ?? run.status]}
      </p>
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
        <h3 id="run-analysis-title">分析报告</h3>
        <p>
          <a
            href={`/api/runs/${run.id}/report.html`}
            target="_blank"
            rel="noreferrer"
          >
            打开独立 HTML 报告
          </a>
          <a href={`/api/runs/${run.id}/evidence.zip`} download>
            下载 ZIP 证据包
          </a>
        </p>
        {run.status === "completed" && (
          <section aria-labelledby="diagnosis-title">
            <h4 id="diagnosis-title">
              {diagnosisMode === "mock" ? "Mock" : "硅基流动"} 结构化诊断
            </h4>
            <button type="button" onClick={() => void generateDiagnosis()}>
              生成 {diagnosisMode === "mock" ? "Mock" : "真实模型"} 诊断
            </button>
            <button type="button" onClick={() => void loadDiagnosisHistory()}>
              刷新诊断状态
            </button>
            {diagnosisError && <p role="alert">{diagnosisError}</p>}
            {diagnosis?.status === "failed" && (
              <p role="alert">
                诊断失败：{diagnosis.error ?? "模型服务不可用"}
              </p>
            )}
            {diagnosis?.output && (
              <>
                <p>
                  模型：{diagnosis.model} · Prompt：{diagnosis.prompt_version} ·
                  证据 {diagnosis.evidence_package.items.length} 条，约{" "}
                  {diagnosis.evidence_package.estimated_tokens} Token
                </p>
                <h5>异常现象</h5>
                <ul>
                  {diagnosis.output.phenomena.map((item) => (
                    <li key={item.description}>
                      {item.description}（
                      {item.evidence_refs.join("、") || "无证据"}）
                    </li>
                  ))}
                </ul>
                <h5>可能原因</h5>
                <ul>
                  {diagnosis.output.possible_causes.map((item) => (
                    <li key={item.cause}>
                      {item.cause} · {item.confidence} ·{" "}
                      {item.is_speculation ? "推测" : "有证据支持"} ·{" "}
                      {item.evidence_refs.join("、") || "无证据"}
                    </li>
                  ))}
                </ul>
                <p>影响范围：{diagnosis.output.impact_scope.join("；")}</p>
                <p>
                  复测建议：{diagnosis.output.retest_recommendations.join("；")}
                </p>
                <p>缺失证据：{diagnosis.output.missing_evidence.join("；")}</p>
                <p>不确定性：{diagnosis.output.uncertainties.join("；")}</p>
                <p>限制：{diagnosis.output.limitations.join("；")}</p>
              </>
            )}
            {diagnosis?.evaluation && (
              <section aria-labelledby="ai-evaluation-title">
                <h5 id="ai-evaluation-title">AI 诊断效果评估</h5>
                <p>{diagnosis.evaluation.summary}</p>
                {diagnosis.evaluation.status === "evaluated" ? (
                  <p>
                    命中：
                    {diagnosis.evaluation.hit_fault_types.join("、") || "无"}
                    ；漏判：
                    {diagnosis.evaluation.missed_fault_types.join("、") || "无"}
                    ； 无证据推测：
                    {diagnosis.evaluation.unsupported_speculation_count} 项。
                  </p>
                ) : (
                  <p>未评估：{diagnosis.evaluation.reason ?? "诊断未完成"}</p>
                )}
                <p>这是 AI 辅助判断，不是检测结果、故障真值或根因证明。</p>
              </section>
            )}
          </section>
        )}
        {run.evaluation_result && (
          <section aria-labelledby="evaluation-result-title">
            <h4 id="evaluation-result-title">判定结果</h4>
            <p>{run.evaluation_result.summary}</p>
            <p>
              检查分布：通过 {run.evaluation_result.distribution.passed}{" "}
              项，失败 {run.evaluation_result.distribution.failed} 项；趋势：{" "}
              {run.evaluation_result.trend.join(" → ") || "无"}
            </p>
            <p>
              阈值来源：
              {
                {
                  formal_specification: "正式规格",
                  engineering_target: "工程目标",
                  version_baseline: "版本基线",
                }[run.evaluation_result.threshold_source]
              }
            </p>
            <p>
              结论：
              {run.evaluation_result.conclusion === "passed"
                ? "通过"
                : run.evaluation_result.conclusion === "failed"
                  ? "不通过"
                  : "仅展示分布与趋势"}
            </p>
          </section>
        )}
        <h4>自动化检测结果</h4>
        <ul>
          {run.checks.map((check) => {
            const anomaly = check.anomaly_windows?.[0];
            const evidenceRefs = check.evidence_refs ?? [];
            return (
              <li key={check.name}>
                <p>{check.message}</p>
                {evidenceRefs.length > 0 && (
                  <p>证据引用：{evidenceRefs.join("、")}</p>
                )}
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
                {(check.category === "resource" ||
                  check.category === "log") && (
                  <p>
                    {check.anomaly_windows.length > 0 && (
                      <>
                        异常时间窗口：
                        {check.anomaly_windows[0].start_s.toFixed(3)}～
                        {check.anomaly_windows[0].end_s.toFixed(3)} 秒；
                      </>
                    )}
                    故障真值对照：
                    {check.truth_comparison === "matched"
                      ? "命中"
                      : check.truth_comparison === "missed"
                        ? "未命中"
                        : "不适用"}
                  </p>
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
