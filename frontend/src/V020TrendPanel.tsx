import { useEffect, useState } from "react";

import {
  compareProjectReports,
  getProjectTrend,
  type ProjectDetail,
  type ProjectTrend,
  type ReportComparison,
} from "./projectsApi";
import { V020TrendComparison } from "./V020TrendComparison";
import { V020TrendFilters, type TrendFilters } from "./V020TrendFilters";
import { V020TrendPoints } from "./V020TrendPoints";
import "./V020Trends.css";

const emptyFilters: TrendFilters = {
  productVersionId: "",
  module: "",
  testGroupId: "",
  caseNumber: "",
};

/** 冻结版“版本与趋势”：真实趋势筛选、状态边界和主动比较。 */
export function V020TrendPanel({
  project,
  trend,
  trendError,
  onRetry,
}: {
  project: ProjectDetail;
  trend: ProjectTrend | null;
  trendError: string | null;
  onRetry: () => void;
}) {
  const [displayed, setDisplayed] = useState<ProjectTrend | null>(trend);
  const [filters, setFilters] = useState<TrendFilters>(emptyFilters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonKind, setComparisonKind] = useState<
    "product_version" | "report"
  >("product_version");
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [comparison, setComparison] = useState<ReportComparison | null>(null);

  useEffect(() => setDisplayed(trend), [trend]);

  const choices =
    comparisonKind === "report"
      ? (trend?.points ?? []).map((point) => ({
          id: point.report_id,
          label: `报告 #${point.report_id} · ${point.product_version} · ${point.test_group}`,
        }))
      : project.product_versions.map((version) => ({
          id: version.id,
          label: `版本 ${version.version}${version.name ? ` · ${version.name}` : ""}`,
        }));

  const submitFilters = async () => {
    setBusy(true);
    setError(null);
    try {
      setDisplayed(await getProjectTrend(project.id, filters));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "趋势筛选失败");
    } finally {
      setBusy(false);
    }
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setDisplayed(trend);
    setError(null);
  };

  const changeKind = (kind: "product_version" | "report") => {
    setComparisonKind(kind);
    setLeftId("");
    setRightId("");
    setComparison(null);
  };

  const submitComparison = async () => {
    if (!leftId || !rightId) {
      setError("请主动选择两个比较对象");
      return;
    }
    if (leftId === rightId) {
      setError("请选择两个不同的比较对象");
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

  return (
    <section aria-label="版本与趋势" className="prototype-trend">
      <div className="prototype-card">
        <h3>版本趋势</h3>
        <p className="prototype-muted">
          趋势只统计已生成的最终报告；过期报告保留并标记，删除报告后对应数据点移除。
        </p>
        {trendError ? (
          <div className="prototype-inline-note" role="alert">
            趋势数据加载失败：{trendError}
            <button
              className="prototype-secondary"
              onClick={onRetry}
              type="button"
            >
              重试
            </button>
          </div>
        ) : !displayed ? (
          <p className="prototype-muted">正在加载趋势数据…</p>
        ) : displayed.status === "empty" ? (
          <>
            <p className="prototype-muted">尚无最终报告，暂无趋势数据</p>
            <p className="prototype-muted">
              趋势只统计已生成的最终报告。完成一次执行并生成报告后，这里会按版本、模块、测试组和用例展示结果变化。
            </p>
          </>
        ) : displayed.status === "filtered_empty" ? (
          <div className="prototype-inline-note" role="status">
            当前筛选没有匹配的最终报告。
            <button
              className="prototype-secondary"
              onClick={resetFilters}
              type="button"
            >
              清除筛选
            </button>
          </div>
        ) : (
          <p className="prototype-muted">{displayed.message}</p>
        )}
      </div>

      {trend && trend.status !== "empty" && (
        <>
          <V020TrendFilters
            busy={busy}
            filters={filters}
            onChange={setFilters}
            onSubmit={() => void submitFilters()}
            project={project}
            trend={trend}
          />

          {displayed?.status === "single" && (
            <p className="prototype-inline-note" role="status">
              只有一个数据点，暂不展示变化趋势。
            </p>
          )}

          <V020TrendPoints points={displayed?.points ?? []} />

          <div className="prototype-card">
            <h3>版本或报告比较</h3>
            <p className="prototype-muted">
              必须主动选择两个产品版本或两份报告，系统不会默认比较最新和上一版本。
            </p>
            <div className="prototype-trend-compare-form">
              <label>
                比较对象类型
                <select
                  aria-label="比较对象类型"
                  onChange={(event) =>
                    changeKind(
                      event.target.value as "product_version" | "report",
                    )
                  }
                  value={comparisonKind}
                >
                  <option value="product_version">产品版本</option>
                  <option value="report">最终报告</option>
                </select>
              </label>
              <label>
                左侧比较对象
                <select
                  aria-label="左侧比较对象"
                  onChange={(event) => setLeftId(event.target.value)}
                  value={leftId}
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
                  aria-label="右侧比较对象"
                  onChange={(event) => setRightId(event.target.value)}
                  value={rightId}
                >
                  <option value="">请选择</option>
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="prototype-secondary"
                disabled={busy}
                onClick={() => void submitComparison()}
                type="button"
              >
                比较
              </button>
            </div>
            {error && (
              <p className="prototype-inline-note" role="alert">
                {error}
              </p>
            )}
            {comparison && <V020TrendComparison comparison={comparison} />}
          </div>
        </>
      )}
    </section>
  );
}
