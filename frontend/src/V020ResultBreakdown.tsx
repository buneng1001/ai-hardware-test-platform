import type { CSSProperties } from "react";

/** 仅呈现后端已有的四类结果，不计算额外的质量或覆盖率指标。 */
export type DisplayResultCounts = {
  passed: number;
  failed: number;
  blocked: number;
  not_executed: number;
};

const categories = [
  { key: "passed", label: "通过", color: "#54cfa7" },
  { key: "failed", label: "失败", color: "#ee8793" },
  { key: "blocked", label: "阻塞", color: "#edbd6c" },
  { key: "not_executed", label: "未执行", color: "#8da8bc" },
] as const;

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function getDisplayedResultTotals(counts: DisplayResultCounts) {
  const passed = safeCount(counts.passed);
  const failed = safeCount(counts.failed);
  const blocked = safeCount(counts.blocked);
  const notExecuted = safeCount(counts.not_executed);
  const tested = passed + failed + blocked;
  const total = tested + notExecuted;
  return {
    tested,
    total,
    rate: tested > 0 ? (passed / tested) * 100 : null,
  };
}

export function V020ResultBreakdown({
  counts,
  label,
  variant = "compact",
}: {
  counts: DisplayResultCounts;
  label: string;
  variant?: "compact" | "ring";
}) {
  const { total, tested, rate } = getDisplayedResultTotals(counts);
  if (total === 0) {
    return (
      <div className="prototype-result-visualization prototype-result-visualization--empty">
        <span className="prototype-muted">暂无可绘制的{label}结果数据</span>
      </div>
    );
  }
  const values = categories.map((category) => ({
    ...category,
    count: safeCount(counts[category.key]),
  }));
  let stop = 0;
  const stops: string[] = [];
  for (const item of values) {
    const next = stop + (item.count / total) * 100;
    stops.push(`${item.color} ${stop}% ${next}%`);
    stop = next;
  }
  const ringStyle: CSSProperties = {
    background: `conic-gradient(${stops.join(", ")})`,
  };
  const readableRate = rate === null ? "—" : `${rate.toFixed(1)}%`;

  return (
    <figure
      aria-label={`${label}：通过 ${counts.passed}，失败 ${counts.failed}，阻塞 ${counts.blocked}，未执行 ${counts.not_executed}`}
      className={`prototype-result-visualization prototype-result-visualization--${variant}`}
    >
      {variant === "ring" && (
        <div
          aria-hidden="true"
          className="prototype-result-ring"
          style={ringStyle}
        >
          <div className="prototype-result-ring-center">
            <strong>{readableRate}</strong>
            <span>已执行通过率</span>
          </div>
        </div>
      )}
      <figcaption>
        <div
          className="prototype-result-segments"
          role="img"
          aria-label={`${label}结果分布`}
        >
          {values
            .filter((item) => item.count > 0)
            .map((item) => (
              <span
                key={item.key}
                className={`prototype-result-segment prototype-result-segment--${item.key}`}
                style={{ width: `${(item.count / total) * 100}%` }}
                title={`${item.label}：${item.count}`}
              />
            ))}
        </div>
        <ul className="prototype-result-legend">
          {values.map((item) => (
            <li key={item.key}>
              <span
                className={`prototype-result-dot prototype-result-dot--${item.key}`}
              />
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </li>
          ))}
        </ul>
        {variant === "ring" && (
          <small className="prototype-muted">
            {tested > 0
              ? "通过率 = 通过 ÷（通过 + 失败 + 阻塞），未执行不计入分母。"
              : "暂无已执行结果，不计算通过率。"}
          </small>
        )}
      </figcaption>
    </figure>
  );
}
