import { useEffect, useRef, useState } from "react";

import { Status } from "./V020PrototypeShared";
import type { FactReport } from "./factReportsApi";

const statusLabels: Record<string, string> = {
  not_enabled: "AI 分析未启用",
  pending: "分析中",
  cancelled: "分析已取消",
  completed: "分析已完成",
  failed: "分析未完成",
};

/** 冻结版报告 AI 区域：只展示接口状态、原因、结构化建议和单独重试。 */
export function V020ReportAnalysisSection({
  report,
  busy,
  onRetry,
  onRerun,
  onCheckRepeat,
  onRefresh,
  onCancel,
}: {
  report: FactReport;
  busy: boolean;
  onRetry: () => void;
  onRerun: (overwrite: boolean) => void;
  onCheckRepeat: () => Promise<{
    same_input: boolean;
    has_previous: boolean;
    running_same_operation: boolean;
    occupied_other: boolean;
  }>;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const analysis = report.analysis;
  const failed = analysis.status === "failed";
  const [waited, setWaited] = useState(0);
  const [confirmRepeat, setConfirmRepeat] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [hasPriorResult, setHasPriorResult] = useState(false);
  const [rerunStopsCurrent, setRerunStopsCurrent] = useState(false);
  const [checkingRepeat, setCheckingRepeat] = useState(false);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const beginRerun = async () => {
    setRepeatError(null);
    setCheckingRepeat(true);
    try {
      const info = await onCheckRepeat();
      if (info.occupied_other) {
        setRepeatError("当前有功能正在占用 AI，请稍后再试。");
        return;
      }
      if (info.same_input || info.running_same_operation) {
        setOverwrite(false);
        setHasPriorResult(info.has_previous);
        setRerunStopsCurrent(info.running_same_operation);
        setConfirmRepeat(true);
      } else {
        onRerun(false);
      }
    } catch (error) {
      setRepeatError(
        error instanceof Error ? error.message : "重试条件检查失败",
      );
    } finally {
      setCheckingRepeat(false);
    }
  };
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  // 分析在后台跑：每 3 秒自动取一次状态，最多等 5 分钟，不需要用户一直点刷新。
  useEffect(() => {
    if (analysis.status !== "pending") {
      setWaited(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      setWaited(elapsed);
      if (elapsed <= 300) refreshRef.current();
    }, 3000);
    return () => clearInterval(timer);
  }, [analysis.status]);
  return (
    <section
      aria-label="报告 AI 分析区域"
      className="prototype-report-ai-section"
    >
      <h2 id="rpt-ai">AI 区域状态</h2>
      <div className="prototype-report-ai-status">
        <Status
          tone={
            analysis.status === "completed"
              ? "good"
              : failed
                ? "warn"
                : "normal"
          }
        >
          {statusLabels[analysis.status] ?? analysis.status}
        </Status>
        <p role={failed ? "alert" : undefined}>{analysis.message}</p>
        {analysis.status === "pending" && (
          <p className="prototype-muted">
            已等待 {waited} 秒，系统每 3 秒自动检查一次，最多等 5 分钟；
            可以关闭弹窗，稍后重新打开也能看到结果。
            {waited > 300 &&
              " 已超过 5 分钟，请确认当前 AI 运行状态；停止完成后可重试。"}
          </p>
        )}
        {failed && analysis.error?.action && (
          <p className="prototype-muted">下一步：{analysis.error.action}</p>
        )}
      </div>
      {analysis.status === "completed" && analysis.output && (
        <div className="prototype-report-ai-output">
          <h3>AI 阶段建议</h3>
          <p>{analysis.output.stage_recommendation.suggestion}</p>
          <p>{analysis.output.stage_recommendation.content}</p>
          <AnalysisItems items={analysis.output.risks} title="AI 风险提示" />
          <AnalysisItems
            items={analysis.output.additional_verifications}
            title="AI 补充验证建议"
          />
          <AnalysisItems
            items={analysis.output.regression_recommendations}
            title="AI 回归建议"
          />
        </div>
      )}
      <div className="prototype-actions">
        {analysis.status === "pending" && (
          <>
            <button
              className="prototype-secondary"
              disabled={busy}
              onClick={onRefresh}
              type="button"
            >
              立即刷新状态
            </button>
            <button
              className="prototype-secondary"
              disabled={Boolean(analysis.stopping)}
              onClick={onCancel}
              type="button"
            >
              {analysis.stopping ? "正在停止" : "取消本次 AI 分析"}
            </button>
          </>
        )}
        <button
          className="prototype-secondary"
          disabled={busy || analysis.status === "pending"}
          onClick={onRetry}
          type="button"
        >
          重试报告分析
        </button>
        <button
          className="prototype-secondary"
          disabled={
            checkingRepeat ||
            Boolean(analysis.stopping) ||
            (busy && analysis.status !== "pending")
          }
          onClick={() => void beginRerun()}
          type="button"
        >
          重新运行分析
        </button>
      </div>
      {repeatError && <p role="alert">{repeatError}</p>}
      {confirmRepeat && (
        <div
          role="dialog"
          aria-label="确认重复报告分析"
          className="prototype-inline-note"
        >
          <p>
            当前输入内容及分析条件与上一次执行完全一致，重新执行可能得到相同或相似的结果。
          </p>{" "}
          {rerunStopsCurrent && (
            <p>重新执行会先停止当前 AI 调用，停止完成后再开始新分析。</p>
          )}
          {hasPriorResult && (
            <label>
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(event) => setOverwrite(event.target.checked)}
              />
              覆盖上一次结果
            </label>
          )}
          <div className="prototype-actions">
            <button
              type="button"
              onClick={() => {
                setConfirmRepeat(false);
                onRerun(overwrite);
              }}
            >
              重新执行
            </button>
            <button type="button" onClick={() => setConfirmRepeat(false)}>
              取消
            </button>
          </div>
        </div>
      )}
      <p className="prototype-muted">
        AI 建议只作为参考，不改变事实结论，也不构成强制质量门禁。
      </p>
    </section>
  );
}

function AnalysisItems({
  title,
  items,
}: {
  title: string;
  items: Array<{ content: string; evidence_refs: string[] }>;
}) {
  return (
    <section>
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p>无</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.content}>
              {item.content}
              <small>（证据：{item.evidence_refs.join("、")}）</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
