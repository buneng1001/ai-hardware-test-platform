import { Status } from "./V020PrototypeShared";
import type { ReportHistoryItem } from "./factReportsApi";

const lifecycleLabels: Record<string, string> = {
  current: "当前在线",
  stale: "已过期",
  superseded: "已覆盖",
};

/** 冻结版报告列表：展示真实在线报告和生命周期状态。 */
export function V020ReportHistoryDialog({
  reports,
  groupName,
  busy,
  onPreview,
  onClose,
}: {
  reports: ReportHistoryItem[];
  groupName: string;
  busy: boolean;
  onPreview: (reportId: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="prototype-report-overlay">
      <section
        className="prototype-report-history"
        role="dialog"
        aria-modal="true"
        aria-label="历史报告列表"
      >
        <header className="prototype-report-dialog-head">
          <div>
            <span className="prototype-kicker">REPORT ARCHIVE</span>
            <h2>历史报告</h2>
            <p>{groupName} · 按生成时间倒序排列</p>
          </div>
          <button
            className="prototype-report-close"
            type="button"
            aria-label="关闭报告列表"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {reports.length === 0 ? (
          <p className="prototype-muted">当前测试组还没有在线报告。</p>
        ) : (
          <div className="prototype-report-history-list">
            {reports.map((item) => (
              <article key={item.id}>
                <div>
                  <span className="prototype-report-id">报告 #{item.id}</span>
                  <Status tone={item.status === "current" ? "good" : "warn"}>
                    {lifecycleLabels[item.status] ?? item.status}
                  </Status>
                  <p>{item.label}</p>
                </div>
                <div className="prototype-report-row-actions">
                  <time>{item.occurred_at.slice(0, 16).replace("T", " ")}</time>
                  <button
                    className="prototype-secondary"
                    disabled={busy}
                    type="button"
                    aria-label={`预览报告 #${item.id}`}
                    onClick={() => onPreview(item.id)}
                  >
                    预览 HTML
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
