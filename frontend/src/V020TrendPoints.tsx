import type { ResultSourceCounts } from "./projectsApi";
import type { ProjectTrendPoint } from "./projectsApi";
import { Status } from "./V020PrototypeShared";

/** 冻结版趋势数据点：过期报告保留并标记。 */
export function V020TrendPoints({ points }: { points: ProjectTrendPoint[] }) {
  return (
    <>
      {points.map((point) => (
        <details className="prototype-trend-point" key={point.report_id}>
          <summary
            className="prototype-trend-point-summary"
            aria-label={`查看报告 #${point.report_id} 的详细趋势`}
          >
            <span className="prototype-trend-point-head">
              <Status
                tone={point.lifecycle_status === "current" ? "good" : "warn"}
              >
                {point.lifecycle_status === "stale"
                  ? "报告已过期"
                  : point.lifecycle_status === "superseded"
                    ? "报告已覆盖"
                    : "当前报告"}
              </Status>
              <strong>
                报告 #{point.report_id} · {point.product_version} ·{" "}
                {point.test_group}
              </strong>
              <time>{point.created_at.slice(0, 16).replace("T", " ")}</time>
            </span>
            <span className="prototype-trend-expand-hint" aria-hidden="true">
              {point.modules.length} 个模块
              <span className="prototype-trend-expand-closed">展开</span>
              <span className="prototype-trend-expand-open">收起</span>
              <span className="prototype-trend-expand-chevron">⌄</span>
            </span>
          </summary>
          <div className="prototype-trend-point-body">
            <TrendCounts counts={point.counts} />
            <div className="prototype-trend-modules">
              {point.modules.map((module) => (
                <p key={module.name}>
                  <strong>{module.name}</strong>：{module.conclusion}
                </p>
              ))}
            </div>
          </div>
        </details>
      ))}
    </>
  );
}
export function TrendCounts({ counts }: { counts: ResultSourceCounts }) {
  return (
    <ul className="prototype-trend-counts">
      <li>
        自动化：通过 {counts.automation.passed} · 失败{" "}
        {counts.automation.failed} · 阻塞 {counts.automation.blocked} · 未执行{" "}
        {counts.automation.not_executed}
      </li>
      <li>
        人工：通过 {counts.manual.passed} · 失败 {counts.manual.failed} · 阻塞{" "}
        {counts.manual.blocked} · 未执行 {counts.manual.not_executed}
      </li>
    </ul>
  );
}
