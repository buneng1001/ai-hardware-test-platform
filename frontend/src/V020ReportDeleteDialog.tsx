/** 冻结版删除在线报告确认：只删除报告本身，不影响底层记录。 */
export function V020ReportDeleteDialog({
  reportLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  reportLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section
      aria-label="删除在线报告影响"
      className="prototype-card prototype-report-delete"
      role="dialog"
    >
      <h3>删除在线报告 {reportLabel}</h3>
      <p className="prototype-muted">
        删除只移除在线报告本身，不删除自动化执行记录、人工记录、数据包，也不会影响已经下载的
        HTML 或纯文字副本。
      </p>
      <div className="prototype-actions">
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
        <button
          className="prototype-primary"
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          确认删除在线报告
        </button>
      </div>
    </section>
  );
}
