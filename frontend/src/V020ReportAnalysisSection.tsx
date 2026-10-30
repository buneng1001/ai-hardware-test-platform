import { Status } from "./V020PrototypeShared";
import type { FactReport } from "./factReportsApi";

const statusLabels: Record<string, string> = {
  not_enabled: "AI 分析未启用",
  pending: "分析中",
  completed: "分析已完成",
  failed: "分析未完成",
};

/** 冻结版报告 AI 区域：只展示接口状态、原因、结构化建议和单独重试。 */
export function V020ReportAnalysisSection({
  report,
  busy,
  onRetry,
  onRefresh,
}: {
  report: FactReport;
  busy: boolean;
  onRetry: () => void;
  onRefresh: () => void;
}) {
  const analysis = report.analysis;
  const failed = analysis.status === "failed";
  return (
    <section
      aria-label="报告 AI 分析区域"
      className="prototype-report-ai-section"
    >
      <h2>AI 区域状态</h2>
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
          <button
            className="prototype-secondary"
            disabled={busy}
            onClick={onRefresh}
            type="button"
          >
            刷新分析状态
          </button>
        )}
        <button
          className="prototype-secondary"
          disabled={busy || analysis.status === "pending"}
          onClick={onRetry}
          type="button"
        >
          重试报告分析
        </button>
      </div>
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
