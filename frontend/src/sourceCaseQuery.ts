import type { SourceTestCase } from "./sourceTestCasesApi";

/** 原始用例筛选条件，字段名与后端查询参数保持一致。 */
export type SourceCaseFilters = {
  module: string;
  test_item: string;
  priority: string;
  software_version: string;
};

export const emptySourceCaseFilters: SourceCaseFilters = {
  module: "",
  test_item: "",
  priority: "",
  software_version: "",
};

/** 只保留有值的筛选条件，避免把空字符串传给后端。 */
export function compactFilters(
  filters: SourceCaseFilters,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value.trim() !== ""),
  );
}

export function hasActiveFilters(filters: SourceCaseFilters): boolean {
  return Object.values(filters).some((value) => value.trim() !== "");
}

/** 把后端返回的勾选状态同步回单条用例。 */
export function matchSelected(
  selected: Set<number>,
): (item: SourceTestCase) => SourceTestCase {
  return (item) => ({ ...item, selected: selected.has(item.id) });
}

/** 筛选项来自当前版本的全部用例，避免筛选后选项被收窄。 */
export function collectFilterOptions(items: SourceTestCase[]) {
  const collect = (field: keyof SourceCaseFilters) =>
    [...new Set(items.map((item) => item[field]).filter(Boolean))].sort();
  return {
    module: collect("module"),
    test_item: collect("test_item"),
    priority: collect("priority"),
    software_version: collect("software_version"),
  };
}
