import type { ProjectDetail, ProjectTrend } from "./projectsApi";

export type TrendFilters = {
  productVersionId: string;
  module: string;
  testGroupId: string;
  caseNumber: string;
};

/** 冻结版趋势筛选：版本、模块、测试组和用例编号。 */
export function V020TrendFilters({
  project,
  trend,
  filters,
  busy,
  onChange,
  onSubmit,
}: {
  project: ProjectDetail;
  trend: ProjectTrend;
  filters: TrendFilters;
  busy: boolean;
  onChange: (filters: TrendFilters) => void;
  onSubmit: () => void;
}) {
  const moduleOptions = [
    ...new Set(
      trend.points.flatMap((point) =>
        point.modules.map((module) => module.name),
      ),
    ),
  ].sort();
  const groupOptions = [
    ...new Map(
      trend.points.map((point) => [point.test_group_id, point.test_group]),
    ).entries(),
  ];
  return (
    <div className="prototype-card prototype-trend-filters">
      <label>
        产品版本
        <select
          aria-label="筛选产品版本"
          onChange={(event) =>
            onChange({ ...filters, productVersionId: event.target.value })
          }
          value={filters.productVersionId}
        >
          <option value="">全部版本</option>
          {project.product_versions.map((version) => (
            <option key={version.id} value={version.id}>
              版本 {version.version}
            </option>
          ))}
        </select>
      </label>
      <label>
        模块
        <select
          aria-label="筛选模块"
          onChange={(event) =>
            onChange({ ...filters, module: event.target.value })
          }
          value={filters.module}
        >
          <option value="">全部模块</option>
          {moduleOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        测试组
        <select
          aria-label="筛选测试组"
          onChange={(event) =>
            onChange({ ...filters, testGroupId: event.target.value })
          }
          value={filters.testGroupId}
        >
          <option value="">全部测试组</option>
          {groupOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        测试用例编号
        <input
          aria-label="筛选用例编号"
          onChange={(event) =>
            onChange({ ...filters, caseNumber: event.target.value })
          }
          value={filters.caseNumber}
        />
      </label>
      <button
        className="prototype-secondary"
        disabled={busy}
        onClick={onSubmit}
        type="button"
      >
        筛选趋势
      </button>
    </div>
  );
}
