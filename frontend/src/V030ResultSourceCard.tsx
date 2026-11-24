import type { ReactNode } from "react";
import {
  getDisplayedResultTotals,
  type DisplayResultCounts,
} from "./V020ResultBreakdown";

const categories = [
  { key: "passed", label: "通过" },
  { key: "failed", label: "失败" },
  { key: "blocked", label: "阻塞" },
  { key: "not_executed", label: "未执行" },
] as const;

/** 单一扁平卡片模板：同一选择即决定可见统计及报告来源。 */
export function V030ResultSourceCard({
  title,
  description,
  selection,
  counts,
  label,
  action,
  note,
}: {
  title: string;
  description: string;
  selection: ReactNode;
  counts?: DisplayResultCounts;
  label: string;
  action: ReactNode;
  note?: string;
}) {
  const totals = counts ? getDisplayedResultTotals(counts) : null;
  return (
    <section
      className="prototype-result-card v030-result-source-card"
      aria-label={title}
    >
      <h3>{title}</h3>
      <div className="v030-result-choice">{selection}</div>
      <p className="prototype-muted v030-result-meta">{description}</p>
      <div className="v030-result-statistics" role="group" aria-label={label}>
        <div className="v030-result-statistics-head">
          <span>测试结果统计</span>
          <span>共 {totals?.total ?? 0} 项</span>
        </div>
        <div
          className="v030-result-counts"
          role="group"
          aria-label={
            counts
              ? `通过 ${counts.passed} · 失败 ${counts.failed} · 阻塞 ${counts.blocked} · 未执行 ${counts.not_executed}`
              : "暂无结果统计"
          }
        >
          {categories.map((item) => (
            <div key={item.key}>
              <strong className={`v030-result-count--${item.key}`}>
                {counts?.[item.key] ?? "—"}
              </strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        <div
          className="prototype-result-segments"
          role="img"
          aria-label={`${label}结果分布`}
        >
          {counts &&
            totals &&
            totals.total > 0 &&
            categories
              .filter((item) => counts[item.key] > 0)
              .map((item) => (
                <span
                  key={item.key}
                  className={`prototype-result-segment prototype-result-segment--${item.key}`}
                  style={{
                    width: `${(counts[item.key] / totals.total) * 100}%`,
                  }}
                />
              ))}
        </div>
        <div className="v030-result-rate">
          <span>已执行通过率</span>
          <strong>
            {totals?.rate == null ? "—" : totals.rate.toFixed(1) + "%"}
          </strong>
        </div>
      </div>
      <p className="prototype-muted v030-result-note">
        {note ?? "请选择参与本次报告的记录。"}
      </p>
      <div className="v030-result-action">{action}</div>
    </section>
  );
}
