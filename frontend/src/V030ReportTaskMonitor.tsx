import { useEffect, useRef, useState } from "react";
import {
  getActiveAiInvocation,
  type ActiveAiInvocation,
} from "./aiGlobalState";
import {
  getFactReport,
  getCurrentIntelligentRegression,
  getIntelligentRegressionProgress,
  type IntelligentRegressionProgress,
} from "./factReportsApi";
import "./V030ReportWorkflow.css";

type ReportTaskOperation = "report_analysis" | "intelligent_regression";
type Notice = {
  id: number;
  message: string;
  invocation: string;
  operation: ReportTaskOperation;
};
const storageKey = "v030-observed-report-ai";

function isReportTask(
  value: ActiveAiInvocation | null | undefined,
): value is ActiveAiInvocation {
  return Boolean(
    value &&
    typeof value.invocation_id === "string" &&
    typeof value.resource_id === "number" &&
    ["report_analysis", "intelligent_regression"].includes(
      value.operation_type,
    ),
  );
}

function recoverTracked(): ActiveAiInvocation | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    return isReportTask(value) ? value : null;
  } catch {
    return null;
  }
}

function persist(value: ActiveAiInvocation | null) {
  try {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
  } catch {
    /* storage optional */
  }
}

function targetLabel(operation: ReportTaskOperation) {
  return operation === "report_analysis" ? "查看 AI 分析" : "查看回归建议";
}

function readStoredRegressionError(reportId: number): string {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(`v030-regression-error:${reportId}`) ?? "null",
    ) as { message?: unknown; createdAt?: unknown } | null;
    if (
      saved &&
      typeof saved.message === "string" &&
      typeof saved.createdAt === "number" &&
      Date.now() - saved.createdAt < 7 * 24 * 60 * 60 * 1000
    )
      return saved.message;
  } catch {
    /* session storage is optional */
  }
  return "";
}

/** Mounted outside page transitions; closing a dialog never cancels the server task. */
export function V030ReportTaskMonitor() {
  const tracked = useRef<ActiveAiInvocation | null>(recoverTracked());
  const [active, setActive] = useState<ActiveAiInvocation | null>(
    tracked.current,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [activeExpanded, setActiveExpanded] = useState(false);
  const [noticeCollapsed, setNoticeCollapsed] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [unreachable, setUnreachable] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [progress, setProgress] =
    useState<import("./factReportsApi").ReportAnalysis["progress"]>(null);
  const [regressionProgress, setRegressionProgress] =
    useState<IntelligentRegressionProgress | null>(null);

  useEffect(() => {
    let live = true;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await getActiveAiInvocation();
        if (!live) return;
        setUnreachable(false);
        setClock(Date.now());
        const old = tracked.current;
        if (old && next?.invocation_id !== old.invocation_id) {
          const id = old.resource_id!;
          let message: string;
          if (old.operation_type === "report_analysis") {
            const report = await getFactReport(id);
            if (!live) return;
            const attempt = report.analysis.progress;
            const terminal =
              attempt?.invocation_id === old.invocation_id
                ? attempt.status
                : report.analysis.status;
            if (terminal === "pending" || terminal === "running") return;
            message =
              terminal === "completed"
                ? "AI 分析已完成"
                : terminal === "cancelled"
                  ? "AI 分析已取消"
                  : "AI 分析未成功，请查看报告";
          } else {
            const current = await getCurrentIntelligentRegression(
              undefined,
              id,
            );
            if (!live) return;
            const savedError = readStoredRegressionError(id);
            message = savedError
              ? `智能回归生成失败：${savedError}`
              : current.result?.invocation_id === old.invocation_id
                ? "智能回归建议已生成"
                : "智能回归调用已结束，请查看当前建议（未确认新结果）";
          }
          setNotice({
            id,
            message,
            invocation: old.invocation_id,
            operation: old.operation_type as ReportTaskOperation,
          });
          setNoticeCollapsed(false);
          setActiveExpanded(false);
          window.dispatchEvent(
            new CustomEvent("v030-report-task-settled", {
              detail: { reportId: id },
            }),
          );
        }
        if (next && old?.invocation_id !== next.invocation_id) {
          setActiveExpanded(false);
        }
        tracked.current = isReportTask(next) ? next : null;
        persist(tracked.current);
        setActive(tracked.current);
        if (tracked.current?.operation_type === "report_analysis") {
          try {
            const report = await getFactReport(tracked.current.resource_id!);
            if (live) setProgress(report.analysis.progress ?? null);
          } catch {
            if (live) setProgress(null);
          }
        } else if (tracked.current?.operation_type === "intelligent_regression") {
          setProgress(null);
          try {
            const currentProgress = await getIntelligentRegressionProgress(
              tracked.current.resource_id!,
            );
            if (live) {
              setRegressionProgress(
                currentProgress?.invocation_id === tracked.current.invocation_id
                  ? currentProgress
                  : null,
              );
            }
          } catch {
            if (live) setRegressionProgress(null);
          }
        } else {
          setProgress(null);
          setRegressionProgress(null);
        }
      } catch {
        if (live) setUnreachable(true);
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onNavigationError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setNavigationError(
        detail?.message || "报告打开失败，请从执行与结果页面重新打开。",
      );
    };
    window.addEventListener("v030-report-navigation-error", onNavigationError);
    return () =>
      window.removeEventListener(
        "v030-report-navigation-error",
        onNavigationError,
      );
  }, []);

  useEffect(() => {
    const onRegressionFailure = (event: Event) => {
      const detail = (
        event as CustomEvent<{ reportId?: number; message?: string }>
      ).detail;
      if (!detail || typeof detail.reportId !== "number" || !detail.message)
        return;
      setNotice((current) => {
        if (
          !current ||
          current.id !== detail.reportId ||
          current.operation !== "intelligent_regression"
        )
          return current;
        return {
          ...current,
          message: `智能回归生成失败：${detail.message}`,
        };
      });
    };
    window.addEventListener(
      "v030-intelligent-regression-failed",
      onRegressionFailure,
    );
    return () =>
      window.removeEventListener(
        "v030-intelligent-regression-failed",
        onRegressionFailure,
      );
  }, []);

  const elapsed = active
    ? Math.max(0, Math.floor((clock - Date.parse(active.started_at)) / 1000))
    : 0;

  const openTarget = (reportId: number, operation: ReportTaskOperation) => {
    setNavigationError("");
    window.dispatchEvent(
      new CustomEvent("v030-open-report-target", {
        detail: {
          reportId,
          target: operation === "report_analysis" ? "ai" : "regression",
        },
      }),
    );
  };

  const taskName =
    active?.operation_type === "report_analysis"
      ? "最终报告 AI 分析"
      : "智能回归建议";
  const batchLabel =
    active?.operation_type === "intelligent_regression"
      ? regressionProgress?.total_batches !== null &&
        regressionProgress?.total_batches !== undefined
        ? `${regressionProgress.completed_batches}/${regressionProgress.total_batches} 个分析单元`
        : ""
      : progress?.total_batches !== null &&
          progress?.total_batches !== undefined &&
          progress.completed_batches !== null
        ? `${progress.completed_batches}/${progress.total_batches} 批`
        : "";
  const regressionPhaseLabels: Record<string, string> = {
    preparing: "准备报告证据",
    global_analysis: "全局回归范围与影响分析",
    module_analysis: "分模块证据分析",
    global_synthesis: "跨模块综合回归策略",
    detail_generation: "新增结构化回归用例生成",
    validating: "结构与证据校验",
    publishing: "发布完整回归方案",
  };
  const responseProgressLabel =
    regressionProgress &&
    ["global_analysis", "module_analysis", "global_synthesis", "detail_generation"].includes(
      regressionProgress.phase,
    )
      ? regressionProgress.stream_event_count > 0
        ? regressionProgress.stream_response_chars > 0
          ? `模型响应已返回 ${regressionProgress.stream_response_chars.toLocaleString()} 字符`
          : "模型已开始响应"
        : "等待模型首段响应"
      : "";
  const phaseLabel =
    active?.operation_type === "intelligent_regression"
      ? regressionProgress
        ? regressionPhaseLabels[regressionProgress.phase] ?? "智能回归处理中"
        : "正在读取任务状态"
      : "";

  return (
    <div className="v030-report-task-stack" aria-label="后台 AI 任务与通知">
      {active &&
        (activeExpanded ? (
          <aside
            className="v030-global-report-task"
            aria-label="后台 AI 任务详情"
          >
            <div className="v030-task-card-heading">
              <strong>
                {taskName} #{active.resource_id}
              </strong>
              <button
                type="button"
                className="v030-task-collapse"
                onClick={() => setActiveExpanded(false)}
              >
                收起
              </button>
            </div>
            <span role="status">
              {unreachable
                ? "状态查询暂不可用"
                : active.stopping
                  ? "正在停止"
                  : "后台运行"}
              {Number.isFinite(elapsed) ? ` · ${elapsed} 秒` : ""}
              {batchLabel ? ` · ${batchLabel}` : ""}
              {phaseLabel ? ` · ${phaseLabel}` : ""}
              {responseProgressLabel ? ` · ${responseProgressLabel}` : ""}
              {regressionProgress?.current_module
                ? ` · ${regressionProgress.current_module}`
                : ""}
            </span>
            <button
              type="button"
              className="v030-report-link"
              onClick={() => {
                openTarget(
                  active.resource_id!,
                  active.operation_type as ReportTaskOperation,
                );
                setActiveExpanded(false);
              }}
            >
              {targetLabel(active.operation_type as ReportTaskOperation)}
            </button>
          </aside>
        ) : (
          <button
            type="button"
            className="v030-task-indicator"
            aria-label="展开后台 AI 任务"
            aria-expanded={false}
            onClick={() => setActiveExpanded(true)}
          >
            <span className="v030-task-indicator-icon" aria-hidden="true">
              AI
            </span>
            <span>后台运行</span>
            {batchLabel && (
              <span className="v030-task-indicator-count">{batchLabel}</span>
            )}
            <span className="v030-task-indicator-chevron" aria-hidden="true">
              ⌃
            </span>
          </button>
        ))}

      {notice &&
        (noticeCollapsed ? (
          <button
            type="button"
            className="v030-task-notice-indicator"
            aria-label="展开 AI 任务完成通知"
            aria-expanded={false}
            onClick={() => setNoticeCollapsed(false)}
          >
            <span aria-hidden="true">✓</span>
            <span>任务已结束</span>
            <span aria-hidden="true">⌃</span>
          </button>
        ) : (
          <aside className="v030-report-task-notice" role="status">
            <div className="v030-task-card-heading">
              <strong>
                报告 #{notice.id} · {notice.message}
              </strong>
              <button
                type="button"
                className="v030-task-collapse"
                onClick={() => setNoticeCollapsed(true)}
              >
                收起
              </button>
            </div>
            <div className="v030-task-notice-actions">
              <button
                type="button"
                className="prototype-primary"
                onClick={() => {
                  openTarget(notice.id, notice.operation);
                  setNoticeCollapsed(true);
                }}
              >
                {targetLabel(notice.operation)}
              </button>
              <button
                type="button"
                className="v030-task-dismiss"
                aria-label="关闭完成通知"
                onClick={() => setNotice(null)}
              >
                ×
              </button>
            </div>
          </aside>
        ))}

      {navigationError && (
        <aside className="v030-report-task-notice" role="alert">
          <div className="v030-task-card-heading">
            <strong>{navigationError}</strong>
            <button
              type="button"
              className="v030-task-collapse"
              onClick={() => setNavigationError("")}
            >
              关闭
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
