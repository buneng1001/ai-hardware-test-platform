import { Status } from "./V020PrototypeShared";
import type { ReportHistoryItem } from "./factReportsApi";

const lifecycleLabels: Record<string, string> = {
  current: "当前在线",
  stale: "已过期",
  superseded: "已覆盖",
  completed: "已完成",
  cancelled: "已取消",
  interrupted: "已中断",
  recorded: "已保存",
};

const typeLabels: Record<string, string> = {
  automation_execution: "自动化执行",
  manual_result: "人工记录",
  fact_report: "最终报告",
};

/** 冻结版报告与历史记录：可查找自动化、人工记录和最终报告。 */
export function V020ReportHistoryDialog({
  items,
  groupName,
  query,
  busy,
  onQueryChange,
  onSearch,
  onPreview,
  onClose,
}: {
  items: ReportHistoryItem[];
  groupName: string;
  query: string;
  busy: boolean;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
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
            <h2>报告与历史记录</h2>
            <p>{groupName} · 按发生时间倒序排列</p>
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
        <div className="prototype-filter-row">
          <label>
            查找
            <input
              aria-label="查找报告与历史记录"
              disabled={busy}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="自动化执行、人工记录或最终报告"
              value={query}
            />
          </label>
          <button
            className="prototype-secondary"
            disabled={busy}
            onClick={onSearch}
            type="button"
          >
            查找
          </button>
        </div>
        {items.length === 0 ? (
          <p className="prototype-muted">没有符合条件的记录。</p>
        ) : (
          <div className="prototype-report-history-list">
            {items.map((item) => (
              <article key={`${item.record_type}-${item.id}`}>
                <div>
                  <span className="prototype-report-id">
                    {item.record_type === "fact_report"
                      ? `报告 #${item.id}`
                      : typeLabels[item.record_type]}
                  </span>
                  <Status tone={item.status === "current" ? "good" : "warn"}>
                    {lifecycleLabels[item.status] ?? item.status}
                  </Status>
                  <p>{item.label}</p>
                </div>
                <div className="prototype-report-row-actions">
                  <time>{item.occurred_at.slice(0, 16).replace("T", " ")}</time>
                  {item.record_type === "fact_report" && (
                    <button
                      className="prototype-secondary"
                      disabled={busy}
                      type="button"
                      aria-label={`预览报告 #${item.id}`}
                      onClick={() => onPreview(item.id)}
                    >
                      预览 HTML
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
