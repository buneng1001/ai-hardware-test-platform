import { useEffect, useRef, useState } from "react";

import { Status } from "./V020PrototypeShared";
import type { FactReport, ReportTestDirection } from "./factReportsApi";

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
  onRetry: (resumeChoice?: "continue" | "restart") => void;
  onRerun: (overwrite: boolean, resumeChoice?: "continue" | "restart") => void;
  onCheckRepeat: () => Promise<{
    resume_available?: boolean;
    same_input: boolean;
    has_previous: boolean;
    running_same_operation: boolean;
    occupied_other: boolean;
  }>;
  onRefresh: () => Promise<void>;
  onCancel: () => Promise<string>;
}) {
  const analysis = report.analysis;
  const failed = analysis.status === "failed";
  const [waited, setWaited] = useState(0);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelNotice, setCancelNotice] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const cancelLock = useRef(false);
  const requestCancel = async () => {
    if (cancelLock.current || analysis.stopping) return;
    cancelLock.current = true;
    setCancelPending(true);
    setCancelNotice("");
    setCancelError("");
    try {
      setCancelNotice(await onCancel());
    } catch (error) {
      setCancelError(
        error instanceof Error
          ? error.message
          : "取消请求失败，请刷新状态后重试。",
      );
    } finally {
      cancelLock.current = false;
      setCancelPending(false);
    }
  };
  const refresh = async () => {
    try {
      await onRefresh();
      setRefreshError("");
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : "分析状态刷新失败",
      );
    }
  };
  const [confirmRepeat, setConfirmRepeat] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [hasPriorResult, setHasPriorResult] = useState(false);
  const [rerunStopsCurrent, setRerunStopsCurrent] = useState(false);
  const [checkingRepeat, setCheckingRepeat] = useState(false);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [resumeIntent, setResumeIntent] = useState<"retry" | "rerun" | null>(
    null,
  );
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const [resumeOverwrite, setResumeOverwrite] = useState(false);
  const beginRetry = async () => {
    setRepeatError(null);
    setCheckingRepeat(true);
    try {
      const info = await onCheckRepeat();
      if (info.occupied_other) {
        setRepeatError("当前有功能正在占用 AI，请稍后再试。");
      } else if (info.resume_available) {
        setResumeIntent("retry");
      } else {
        onRetry();
      }
    } catch (error) {
      setRepeatError(
        error instanceof Error ? error.message : "续做条件检查失败",
      );
    } finally {
      setCheckingRepeat(false);
    }
  };

  const beginRerun = async () => {
    setRepeatError(null);
    setCheckingRepeat(true);
    try {
      const info = await onCheckRepeat();
      setResumeAvailable(Boolean(info.resume_available));
      if (info.occupied_other) {
        setRepeatError("当前有功能正在占用 AI，请稍后再试。");
        return;
      }
      if (info.same_input || info.running_same_operation) {
        setOverwrite(false);
        setHasPriorResult(info.has_previous);
        setRerunStopsCurrent(info.running_same_operation);
        setConfirmRepeat(true);
      } else if (info.resume_available) {
        setResumeIntent("rerun");
        setResumeOverwrite(false);
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
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // 后端进入终态才停止查询；不能把前端等待时长当作业务超时。
  useEffect(() => {
    if (analysis.status !== "pending") {
      setWaited(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      setWaited(elapsed);
      void refreshRef.current();
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
          {analysis.stopping && analysis.status === "pending"
            ? "正在停止"
            : (statusLabels[analysis.status] ?? analysis.status)}
        </Status>
        <p role={failed ? "alert" : undefined}>{analysis.message}</p>
        {analysis.status === "pending" && (
          <p className="prototype-muted">
            已等待 {waited} 秒，系统每 3 秒自动检查状态，直至任务结束。
            {analysis.stopping
              ? " 已请求停止；当前模型请求返回或超时并完成清理后，才能重新运行。"
              : waited > 300
                ? " 当前等待时间较长，可请求停止，或继续等待结果。"
                : " 可以关闭弹窗，稍后重新打开查看结果。"}
          </p>
        )}
        {failed && analysis.error?.action && (
          <p className="prototype-muted">下一步：{analysis.error.action}</p>
        )}
        {cancelError && <p role="alert">取消失败：{cancelError}</p>}
        {refreshError && (
          <p role="alert">状态查询失败：{refreshError}；系统将继续尝试查询。</p>
        )}
        {cancelNotice && (
          <p role="status">
            {analysis.status === "cancelled"
              ? "本次 AI 分析已取消。"
              : analysis.status !== "pending"
                ? "本次分析已结束，已刷新实际结果。"
                : cancelNotice}
          </p>
        )}
      </div>
      {analysis.status === "completed" && analysis.output && (
        <div className="prototype-report-ai-output">
          {analysis.output.test_directions != null ? (
            <ProfessionalAnalysis output={analysis.output} />
          ) : (
            <>
              <h3>AI 阶段建议</h3>
              <p>{analysis.output.stage_recommendation.suggestion}</p>
              <p>{analysis.output.stage_recommendation.content}</p>
              <AnalysisItems
                items={analysis.output.risks}
                title="AI 风险提示"
              />
              <AnalysisItems
                items={analysis.output.additional_verifications}
                title="AI 补充验证建议"
              />
              <AnalysisItems
                items={analysis.output.regression_recommendations}
                title="AI 回归建议"
              />
            </>
          )}
        </div>
      )}
      <div className="prototype-actions">
        {analysis.status === "pending" && (
          <>
            <button
              className="prototype-secondary"
              disabled={busy}
              onClick={() => void refresh()}
              type="button"
            >
              立即刷新状态
            </button>
            <button
              className="prototype-secondary"
              disabled={cancelPending || Boolean(analysis.stopping)}
              onClick={() => void requestCancel()}
              type="button"
            >
              {analysis.stopping
                ? "正在停止"
                : cancelPending
                  ? "正在提交取消…"
                  : "取消本次 AI 分析"}
            </button>
          </>
        )}
        <button
          className="prototype-secondary"
          disabled={busy || checkingRepeat || analysis.status === "pending"}
          onClick={() => void beginRetry()}
          type="button"
        >
          重试报告分析
        </button>
        <button
          className="prototype-secondary"
          disabled={
            checkingRepeat ||
            cancelPending ||
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
                if (resumeAvailable) {
                  setResumeOverwrite(overwrite);
                  setResumeIntent("rerun");
                } else {
                  onRerun(overwrite);
                }
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
      {resumeIntent !== null && (
        <div
          role="dialog"
          aria-label="报告 AI 分批续做"
          className="prototype-inline-note"
        >
          <p>
            上一次 AI 分析未完成，但存在已保存的有效检查点。请选择如何处理：
          </p>
          <div className="prototype-actions">
            <button
              type="button"
              onClick={() => {
                const intent = resumeIntent;
                setResumeIntent(null);
                if (intent === "retry") onRetry("continue");
                else onRerun(resumeOverwrite, "continue");
              }}
            >
              继续进行
            </button>
            <button
              type="button"
              onClick={() => {
                const intent = resumeIntent;
                setResumeIntent(null);
                if (intent === "retry") onRetry("restart");
                else onRerun(resumeOverwrite, "restart");
              }}
            >
              重新运行
            </button>
            <button type="button" onClick={() => setResumeIntent(null)}>
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

const dimensionLabels: Record<string, string> = {
  functional: "功能完整性",
  performance: "性能效率",
  integration: "功能关联与集成",
  compatibility: "兼容性",
  interaction: "交互与易用性",
  reliability: "可靠性与恢复",
  security: "信息安全",
  maintainability: "可维护性",
  flexibility: "灵活性",
  safety: "运行安全",
  environment: "环境适应性",
  data_quality: "数据质量",
};
const priorityLabels = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};
const priorityOrder = { high: 0, medium: 1, low: 2 };

function ProfessionalAnalysis({
  output,
}: {
  output: NonNullable<FactReport["analysis"]["output"]>;
}) {
  const directions = [...(output.test_directions ?? [])].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );
  return (
    <div className="v030-professional-analysis">
      <section className="v030-analysis-block">
        <h3>01 综合评价</h3>
        <p>{output.stage_recommendation.suggestion}</p>
      </section>
      <section className="v030-analysis-block">
        <h3>02 重点测试方向</h3>
        <p className="prototype-muted">
          按优先级排序 · {directions.length} 项方向 · 点击展开分析依据
        </p>
        {directions.length === 0 ? (
          <p>当前分析未识别出具体测试方向，请结合综合评价复核证据范围。</p>
        ) : (
          <div className="v030-direction-list">
            {directions.map((item, index) => (
              <DirectionItem
                key={`${item.dimension}-${item.title}-${index}`}
                item={item}
              />
            ))}
          </div>
        )}
      </section>
      <section className="v030-analysis-block">
        <h3>03 下一阶段测试重点</h3>
        <p>{output.stage_recommendation.content}</p>
      </section>
      <section className="v030-analysis-block">
        <h3>04 AI 回归建议</h3>
        {output.regression_recommendations.length === 0 ? (
          <p>当前没有明确回归候选，请结合变更范围和历史证据判断。</p>
        ) : (
          <ul className="v030-regression-list">
            {output.regression_recommendations.map((item, index) => (
              <li key={index}>
                <p>{item.content}</p>
                <small>依据：{item.evidence_refs.join("、")}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DirectionItem({ item }: { item: ReportTestDirection }) {
  return (
    <details
      className="v030-direction"
      open={item.priority === "high" || undefined}
    >
      <summary>
        <span className="v030-direction-heading">
          <strong>{item.title}</strong>
          <small>{dimensionLabels[item.dimension] ?? item.dimension}</small>
        </span>
        <span
          className={`v030-direction-priority v030-direction-priority--${item.priority}`}
        >
          {priorityLabels[item.priority]}
        </span>
      </summary>
      <dl>
        <dt>覆盖缺口</dt>
        <dd>{item.coverage_gap}</dd>
        <dt>潜在风险</dt>
        <dd>{item.risk}</dd>
        <dt>测试方向</dt>
        <dd>{item.direction}</dd>
      </dl>
      <small className="v030-direction-evidence">
        依据：{item.evidence_refs.join("、")}
      </small>
    </details>
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
