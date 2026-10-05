import type {
  FactReport,
  ReportAttachmentCleanupImpact,
} from "./factReportsApi";

type ReportAttachmentActionsProps = {
  report: FactReport;
  cleanupImpact: ReportAttachmentCleanupImpact | null;
  busy: boolean;
  onPrepareCleanup: () => void;
  onCleanup: () => void;
};

export function ReportAttachmentActions({
  report,
  cleanupImpact,
  busy,
  onPrepareCleanup,
  onCleanup,
}: ReportAttachmentActionsProps) {
  return (
    <section aria-label="报告附件">
      <h5>已使用附件</h5>
      <p>
        {report.attachment_summary.attachment_count} 个，共{" "}
        {report.attachment_summary.total_size_bytes} 字节
      </p>
      <ul>
        {report.attachment_summary.attachments.map((attachment) => (
          <li key={`${attachment.id}-${attachment.filename}`}>
            {attachment.filename}：已使用，
            {attachment.storage_status === "cleaned"
              ? "已清理"
              : "原始文件已保留"}
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy} onClick={onPrepareCleanup}>
        清理已使用附件
      </button>
      {cleanupImpact && (
        <section aria-label="附件清理影响确认">
          <p>{cleanupImpact.message}</p>
          <p>
            将清理 {cleanupImpact.attachment_count} 个附件，共{" "}
            {cleanupImpact.total_size_bytes} 字节。
          </p>
          <button type="button" disabled={busy} onClick={onCleanup}>
            确认清理已使用附件
          </button>
        </section>
      )}
    </section>
  );
}
