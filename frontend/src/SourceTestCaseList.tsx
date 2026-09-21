import type { SourceTestCase } from "./sourceTestCasesApi";

const filterFields = [
  ["module", "模块"],
  ["test_item", "测试项"],
  ["priority", "优先级"],
  ["software_version", "软件版本"],
] as const;

type SourceTestCaseListProps = {
  items: SourceTestCase[];
  filters: Record<string, string>;
  selectedIds: number[];
  onFilterChange: (field: string, value: string) => void;
  onSelectAll: () => void;
  onInvert: () => void;
  onToggle: (item: SourceTestCase) => void;
};

export function SourceTestCaseList({
  items,
  filters,
  selectedIds,
  onFilterChange,
  onSelectAll,
  onInvert,
  onToggle,
}: SourceTestCaseListProps) {
  return (
    <>
      <section className="source-case-filters" aria-label="原始用例筛选">
        {filterFields.map(([field, label]) => (
          <label key={field}>
            {label}
            <input
              value={filters[field] ?? ""}
              onChange={(event) => onFilterChange(field, event.target.value)}
            />
          </label>
        ))}
        <button type="button" onClick={onSelectAll}>
          全选当前筛选结果
        </button>
        <button type="button" onClick={onInvert}>
          反选当前筛选结果
        </button>
      </section>
      {items.length === 0 ? (
        <p className="workspace-empty">还没有原始测试用例</p>
      ) : (
        <div className="source-case-table" role="list">
          {items.map((item) => (
            <label className="source-case-row" key={item.id}>
              <input
                aria-label={`选择 ${item.case_number}`}
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => onToggle(item)}
              />
              <span>{item.case_number}</span>
              <strong>{item.title}</strong>
              <span>{item.module || "未分类"}</span>
              {item.source_import_status === "import_deleted" && (
                <em>导入记录已删除</em>
              )}
            </label>
          ))}
        </div>
      )}
    </>
  );
}
