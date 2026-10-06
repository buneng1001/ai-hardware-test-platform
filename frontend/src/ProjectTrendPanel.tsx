import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  compareProjectReports,
  getProjectTrend,
  type ProjectDetail,
  type ProjectTrend,
  type ReportComparison,
  type ResultSourceCounts,
} from "./projectsApi";
import { TrendChart } from "./TrendChart";

type ProjectTrendPanelProps = {
  project: ProjectDetail;
  trend: ProjectTrend | null;
};

type Filters = {
  productVersionId: string;
  module: string;
  testGroupId: string;
  caseNumber: string;
};

const emptyFilters: Filters = {
  productVersionId: "",
  module: "",
  testGroupId: "",
  caseNumber: "",
};

function Counts({ counts }: { counts: ResultSourceCounts }) {
  const format = (label: string, values: ResultSourceCounts["automation"]) =>
    `${label}：通过 ${values.passed}，失败 ${values.failed}，阻塞 ${values.blocked}，未执行 ${values.not_executed}`;
  return (
    <ul className="trend-counts">
      <li>{format("自动化", counts.automation)}</li>
      <li>{format("人工", counts.manual)}</li>
    </ul>
  );
}

export function ProjectTrendPanel({ project, trend }: ProjectTrendPanelProps) {
  const [displayedTrend, setDisplayedTrend] = useState<ProjectTrend | null>(
    trend,
  );
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [comparisonKind, setComparisonKind] = useState<
    "product_version" | "report"
  >("product_version");
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [comparison, setComparison] = useState<ReportComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDisplayedTrend(trend), [trend]);

  const moduleOptions = useMemo(
    () =>
      [
        ...new Set(
          (trend?.points ?? []).flatMap((point) =>
            point.modules.map((item) => item.name),
          ),
        ),
      ].sort(),
    [trend],
  );
  const groupOptions = useMemo(
    () =>
      [
        ...new Map(
          (trend?.points ?? []).map((point) => [
            point.test_group_id,
            point.test_group,
          ]),
        ).entries(),
      ].sort(([, left], [, right]) => left.localeCompare(right)),
    [trend],
  );
  const reportOptions = trend?.points ?? [];

  const submitFilters = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDisplayedTrend(await getProjectTrend(project.id, filters));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "趋势加载失败");
    } finally {
      setBusy(false);
    }
  };

  const submitComparison = async (event: FormEvent) => {
    event.preventDefault();
    if (!leftId || !rightId) {
      setError("请主动选择两个比较对象");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const command =
        comparisonKind === "report"
          ? { left_report_id: Number(leftId), right_report_id: Number(rightId) }
          : {
              left_product_version_id: Number(leftId),
              right_product_version_id: Number(rightId),
            };
      setComparison(await compareProjectReports(project.id, command));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "比较失败");
    } finally {
      setBusy(false);
    }
  };

  const changeComparisonKind = (kind: "product_version" | "report") => {
    setComparisonKind(kind);
    setLeftId("");
    setRightId("");
    setComparison(null);
  };
  const choices =
    comparisonKind === "report"
      ? reportOptions.map((point) => ({
          id: point.report_id,
          label: `报告 #${point.report_id} · ${point.product_version} · ${point.test_group}`,
        }))
      : project.product_versions.map((version) => ({
          id: version.id,
          label: `版本 ${version.version}${version.name ? ` · ${version.name}` : ""}`,
        }));

  return (
    <section className="project-trends" aria-label="项目趋势">
      <h4>项目趋势</h4>
      <p>{displayedTrend?.message ?? "正在加载趋势…"}</p>
      <form
        className="trend-filters"
        onSubmit={(event) => void submitFilters(event)}
      >
        <label>
          产品版本
          <select
            value={filters.productVersionId}
            onChange={(event) =>
              setFilters({ ...filters, productVersionId: event.target.value })
            }
          >
            <option value="">全部版本</option>
            {project.product_versions.map((version) => (
              <option
                key={version.id}
                value={version.id}
              >{`版本 ${version.version}`}</option>
            ))}
          </select>
        </label>
        <label>
          模块
          <select
            value={filters.module}
            onChange={(event) =>
              setFilters({ ...filters, module: event.target.value })
            }
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
            value={filters.testGroupId}
            onChange={(event) =>
              setFilters({ ...filters, testGroupId: event.target.value })
            }
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
            value={filters.caseNumber}
            onChange={(event) =>
              setFilters({ ...filters, caseNumber: event.target.value })
            }
          />
        </label>
        <button disabled={busy}>筛选趋势</button>
      </form>
      {displayedTrend?.points.length ? (
        <TrendChart points={displayedTrend.points} />
      ) : null}
      {displayedTrend?.points.map((point) => (
        <article className="trend-point" key={point.report_id}>
          <h5>
            报告 #{point.report_id} · {point.product_version} ·{" "}
            {point.test_group}
          </h5>
          <p>
            {new Date(point.created_at).toLocaleString()}{" "}
            {point.lifecycle_status === "stale" && "· 报告已过期"}
          </p>
          <Counts counts={point.counts} />
          <div className="trend-module-list">
            {point.modules.map((module) => (
              <article key={module.name}>
                <p>
                  {module.name}：{module.conclusion}
                </p>
                <Counts counts={module.counts} />
              </article>
            ))}
          </div>
        </article>
      ))}
      <form
        className="comparison-form"
        onSubmit={(event) => void submitComparison(event)}
      >
        <h4>版本或报告比较</h4>
        <p>系统不会自动选择比较对象。</p>
        <label>
          比较对象类型
          <select
            value={comparisonKind}
            onChange={(event) =>
              changeComparisonKind(
                event.target.value as "product_version" | "report",
              )
            }
          >
            <option value="product_version">产品版本</option>
            <option value="report">最终报告</option>
          </select>
        </label>
        <label>
          左侧比较对象
          <select
            value={leftId}
            onChange={(event) => setLeftId(event.target.value)}
          >
            <option value="">请选择</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          右侧比较对象
          <select
            value={rightId}
            onChange={(event) => setRightId(event.target.value)}
          >
            <option value="">请选择</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy}>比较</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {comparison && (
        <section className="comparison-result" aria-label="版本或报告比较结果">
          <h4>
            {comparison.left.label} → {comparison.right.label}
          </h4>
          <div className="comparison-counts">
            <section>
              <h5>左侧状态</h5>
              <Counts counts={comparison.counts.left} />
            </section>
            <section>
              <h5>右侧状态</h5>
              <Counts counts={comparison.counts.right} />
            </section>
          </div>
          <p>
            新增模块：{comparison.added_modules.join("、") || "无"}；移除模块：
            {comparison.removed_modules.join("、") || "无"}
          </p>
          <p>
            新增范围：
            {comparison.added_scope
              .map((item) => item.case_number)
              .join("、") || "无"}
            ；移除范围：
            {comparison.removed_scope
              .map((item) => item.case_number)
              .join("、") || "无"}
          </p>
          <ul>
            {comparison.added_scope.map((item) => (
              <li key={`added-${item.case_number}-${item.module}`}>
                新增：{item.case_number} · {item.module} ·{" "}
                {item.title || "未命名用例"}
              </li>
            ))}
            {comparison.removed_scope.map((item) => (
              <li key={`removed-${item.case_number}-${item.module}`}>
                移除：{item.case_number} · {item.module} ·{" "}
                {item.title || "未命名用例"}
              </li>
            ))}
          </ul>
          <p>
            无法对齐范围：
            {comparison.unaligned_scope
              .map((item) => item.case_number)
              .join("、") || "无"}
          </p>
          <ul>
            {comparison.unaligned_scope.map((item) => (
              <li key={item.case_number}>
                {item.case_number}：左侧 {item.left_modules.join("、")}；右侧{" "}
                {item.right_modules.join("、")}
              </li>
            ))}
          </ul>
          <p>
            仍有风险模块：
            {comparison.unresolved_risk_modules.join("、") || "无"}
          </p>
          <div className="comparison-module-list">
            {comparison.modules.map((module) => (
              <article key={module.name}>
                <p>
                  {module.name}：{module.left_conclusion} →{" "}
                  {module.right_conclusion}
                </p>
                <Counts counts={module.left} />
                <Counts counts={module.right} />
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
