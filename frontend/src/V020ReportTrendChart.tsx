import type { ProjectTrendPoint } from "./projectsApi";
import { getDisplayedResultTotals } from "./V020ResultBreakdown";

/** 每根柱子仅对应一份真实最终报告；不把报告数误称为测试用例总数。 */
export function V020ReportTrendChart({
  points,
}: {
  points: ProjectTrendPoint[];
}) {
  if (points.length < 2) return null;
  const chronological = [...points].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.report_id - b.report_id,
  );
  return (
    <section
      className="prototype-card prototype-report-trend-chart"
      aria-label="最终报告通过率趋势"
    >
      <div className="prototype-chart-heading">
        <div>
          <h3>最终报告通过率变化</h3>
          <p className="prototype-muted">
            每个数据点代表一份已生成的最终报告；过期报告仍保留状态标记。
          </p>
        </div>
        <span className="prototype-chart-unit">已执行用例通过率 · %</span>
      </div>
      <div
        className="prototype-trend-plot"
        role="list"
        aria-label="最终报告按生成时间排列"
      >
        {chronological.map((point) => {
          const combined = {
            passed: point.counts.automation.passed + point.counts.manual.passed,
            failed: point.counts.automation.failed + point.counts.manual.failed,
            blocked:
              point.counts.automation.blocked + point.counts.manual.blocked,
            not_executed:
              point.counts.automation.not_executed +
              point.counts.manual.not_executed,
          };
          const { rate, tested } = getDisplayedResultTotals(combined);
          return (
            <div
              className="prototype-trend-plot-item"
              key={point.report_id}
              role="listitem"
              aria-label={`最终报告 ${point.report_id}：${rate === null ? "暂无已执行用例" : `通过率 ${rate.toFixed(1)}%`}`}
            >
              <div className="prototype-trend-bar-area">
                <span className="prototype-trend-bar-value">
                  {rate === null ? "—" : `${rate.toFixed(1)}%`}
                </span>
                <div
                  className={`prototype-trend-bar ${rate === null ? "prototype-trend-bar--empty" : ""}`}
                  style={{ height: `${rate ?? 0}%` }}
                  aria-hidden="true"
                />
              </div>
              <strong className="prototype-trend-plot-version">
                {point.product_version}
              </strong>
              <small>报告 #{point.report_id}</small>
              <small>
                {point.lifecycle_status === "current"
                  ? "当前"
                  : point.lifecycle_status === "stale"
                    ? "已过期"
                    : "已覆盖"}
              </small>
              <span className="prototype-trend-plot-detail">
                已执行 {tested} 条
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
