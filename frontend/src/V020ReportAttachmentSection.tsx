import type {
  FactReport,
  ReportAttachmentCleanupImpact,
} from "./factReportsApi";

/** 冻结版报告附件：展示使用状态，并确认后清理当前报告使用的原始附件。 */
export function V020ReportAttachmentSection({
  report,
  cleanupImpact,
  busy,
  onPrepareCleanup,
  onCancelCleanup,
  onConfirmCleanup,
}: {
  report: FactReport;
  cleanupImpact: ReportAttachmentCleanupImpact | null;
  busy: boolean;
  onPrepareCleanup: () => void;
  onCancelCleanup: () => void;
  onConfirmCleanup: () => void;
}) {
  const summary = report.attachment_summary;
  return (
    <section aria-label="报告附件与清理">
      <h2>已使用附件</h2>
      <p>
        共 {summary.attachment_count} 个，合计 {summary.total_size_bytes} 字节。
      </p>
      {summary.attachments.length === 0 ? (
        <p className="prototype-muted">当前报告没有使用人工附件。</p>
      ) : (
        <ul>
          {summary.attachments.map((attachment) => (
            <li key={`${attachment.id}-${attachment.filename}`}>
              {attachment.filename}：已使用，
              {attachment.storage_status === "cleaned"
                ? "原始文件已清理"
                : "原始文件已保留"}
            </li>
          ))}
        </ul>
      )}
      {report.lifecycle_status !== "superseded" &&
        summary.attachment_count > 0 && (
          <button
            className="prototype-secondary"
            disabled={busy}
            onClick={onPrepareCleanup}
            type="button"
          >
            清理已使用附件
          </button>
        )}
      {cleanupImpact && (
        <section
          aria-label="附件清理影响确认"
          className="prototype-card prototype-report-cleanup"
          role="dialog"
        >
          <p>{cleanupImpact.message}</p>
          <p>
            将清理 {cleanupImpact.attachment_count} 个附件，共{" "}
            {cleanupImpact.total_size_bytes} 字节。
          </p>
          <div className="prototype-actions">
            <button
              className="prototype-secondary"
              disabled={busy}
              onClick={onCancelCleanup}
              type="button"
            >
              取消
            </button>
            <button
              className="prototype-primary"
              disabled={busy}
              onClick={onConfirmCleanup}
              type="button"
            >
              确认清理已使用附件
            </button>
          </div>
        </section>
      )}
      <p className="prototype-muted">
        只清理当前报告已使用的原始附件；人工文字结果、附件名称和“已清理”状态保留，未使用附件不受影响。
      </p>
    </section>
  );
}
