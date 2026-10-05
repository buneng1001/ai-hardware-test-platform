import type { ReportHistoryItem } from "./factReportsApi";

type ReportHistoryProps = {
  items: ReportHistoryItem[];
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
};

export function ReportHistory({
  items,
  query,
  onQueryChange,
  onSearch,
}: ReportHistoryProps) {
  return (
    <section aria-label="报告与历史记录">
      <h5>报告与历史记录</h5>
      <label>
        查找自动化、人工记录和最终报告
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <button type="button" onClick={onSearch}>
        查找
      </button>
      <ul>
        {items.map((item) => (
          <li key={`${item.record_type}-${item.id}`}>
            {item.label}：{item.status}
          </li>
        ))}
      </ul>
    </section>
  );
}
