import type {
  FactReport,
  ReportAttachmentCleanupImpact,
} from "./factReportsApi";
import { ReportAttachmentActions } from "./ReportAttachmentActions";

type FactReportViewProps = {
  report: FactReport;
  cleanupImpact: ReportAttachmentCleanupImpact | null;
  busy: boolean;
  onPrepareCleanup: () => void;
  onCleanup: () => void;
  onRetryAnalysis: () => void;
  onDelete: () => void;
};

export function FactReportView({
  report,
  cleanupImpact,
  busy,
  onPrepareCleanup,
  onCleanup,
  onRetryAnalysis,
  onDelete,
}: FactReportViewProps) {
  return (
    <>
      <p>在线报告状态：{reportStatusLabel(report.lifecycle_status)}</p>
      {report.snapshot.warnings.map((warning) => (
        <p key={warning} role="status">
          {warning}
        </p>
      ))}
      <p>阶段推进结论：{report.snapshot.stage_progress.conclusion}</p>
      <p>AI 分析：{report.analysis.message}</p>
      <ReportAttachmentActions
        report={report}
        cleanupImpact={cleanupImpact}
        busy={busy}
        onPrepareCleanup={onPrepareCleanup}
        onCleanup={onCleanup}
      />
      {report.analysis.output && (
        <section aria-label="AI 分析建议">
          <p>
            AI 阶段建议：
            {report.analysis.output.stage_recommendation.suggestion}
          </p>
          <AnalysisItems
            title="高风险问题"
            items={report.analysis.output.risks}
          />
          <AnalysisItems
            title="补充验证"
            items={report.analysis.output.additional_verifications}
          />
          <AnalysisItems
            title="回归建议"
            items={report.analysis.output.regression_recommendations}
          />
        </section>
      )}
      <button type="button" disabled={busy} onClick={onRetryAnalysis}>
        重试报告分析
      </button>
      <iframe
        title="事实报告预览"
        src={`/api/fact-reports/${report.id}.html`}
      />
      <p>
        <a href={`/api/fact-reports/${report.id}.html`} download>
          下载 HTML 报告
        </a>{" "}
        ·{" "}
        <a href={`/api/fact-reports/${report.id}.txt`} download>
          下载纯文字报告
        </a>
      </p>
      <button type="button" disabled={busy} onClick={onDelete}>
        删除在线报告
      </button>
    </>
  );
}

function reportStatusLabel(status: FactReport["lifecycle_status"]) {
  return { current: "已生成", stale: "已过期", superseded: "已覆盖" }[status];
}

function AnalysisItems({
  title,
  items,
}: {
  title: string;
  items: { content: string }[];
}) {
  return (
    <section>
      <h5>{title}</h5>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.content}>{item.content}</li>
          ))}
        </ul>
      ) : (
        <p>无</p>
      )}
    </section>
  );
}
