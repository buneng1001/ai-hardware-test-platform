import type { ProjectTrendPoint } from "./projectsApi";

function value(point: ProjectTrendPoint, kind: "passed" | "risk") {
  const counts = [point.counts.automation, point.counts.manual];
  return counts.reduce(
    (total, item) =>
      total + (kind === "passed" ? item.passed : item.failed + item.blocked),
    0,
  );
}

function line(values: number[], maximum: number) {
  return values
    .map((item, index) => {
      const x = 20 + (index * 240) / (values.length - 1);
      return `${index ? "L" : "M"}${x} ${100 - (item * 80) / maximum}`;
    })
    .join(" ");
}

export function TrendChart({ points }: { points: ProjectTrendPoint[] }) {
  if (points.length < 2) return <p>单个报告仅显示数据点，不绘制趋势线。</p>;
  const passed = points.map((point) => value(point, "passed"));
  const risks = points.map((point) => value(point, "risk"));
  const maximum = Math.max(1, ...passed, ...risks);
  return (
    <figure className="trend-chart" aria-label="通过与风险趋势图">
      <figcaption>通过（蓝）与失败/阻塞（橙）趋势</figcaption>
      <svg viewBox="0 0 280 120" role="img" aria-label="最终报告状态趋势">
        <path className="trend-chart-axis" d="M20 100H260" />
        <path className="trend-chart-passed" d={line(passed, maximum)} />
        <path className="trend-chart-risk" d={line(risks, maximum)} />
      </svg>
    </figure>
  );
}
