import type { ResultSourceCounts } from "./projectsApi";
import type { ProjectTrendPoint } from "./projectsApi";
import { Status } from "./V020PrototypeShared";

/** 冻结版趋势数据点：过期报告保留并标记。 */
export function V020TrendPoints({ points }: { points: ProjectTrendPoint[] }) {
  return (
    <>
      {points.map((point) => (
        <article className="prototype-trend-point" key={point.report_id}>
          <div className="prototype-trend-point-head">
            <Status
              tone={point.lifecycle_status === "current" ? "good" : "warn"}
            >
              {point.lifecycle_status === "stale"
                ? "报告已过期"
                : point.lifecycle_status === "superseded"
                  ? "报告已覆盖"
                  : "当前报告"}
            </Status>
            <h4>
              报告 #{point.report_id} · {point.product_version} ·{" "}
              {point.test_group}
            </h4>
            <time>{point.created_at.slice(0, 16).replace("T", " ")}</time>
          </div>
          <TrendCounts counts={point.counts} />
          <div className="prototype-trend-modules">
            {point.modules.map((module) => (
              <p key={module.name}>
                <strong>{module.name}</strong>：{module.conclusion}
              </p>
            ))}
          </div>
        </article>
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
