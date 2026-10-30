import type { ReportComparison, ResultSourceCounts } from "./projectsApi";

/** 冻结版版本/报告比较结果：明确区分新增、移除和无法对齐的范围。 */
export function V020TrendComparison({
  comparison,
}: {
  comparison: ReportComparison;
}) {
  return (
    <section
      aria-label="版本或报告比较结果"
      className="prototype-trend-comparison"
    >
      <h4>
        {comparison.left.label} → {comparison.right.label}
      </h4>
      <div className="prototype-trend-comparison-counts">
        <div>
          <h5>左侧状态</h5>
          <Counts counts={comparison.counts.left} />
        </div>
        <div>
          <h5>右侧状态</h5>
          <Counts counts={comparison.counts.right} />
        </div>
      </div>
      <p>
        新增模块：{comparison.added_modules.join("、") || "无"}；移除模块：
        {comparison.removed_modules.join("、") || "无"}
      </p>
      <p>
        新增测试范围：
        {comparison.added_scope.map((item) => item.case_number).join("、") ||
          "无"}
        ；移除测试范围：
        {comparison.removed_scope.map((item) => item.case_number).join("、") ||
          "无"}
      </p>
      <ul className="prototype-trend-scope-list">
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
      <h5>无法对齐的测试范围</h5>
      {comparison.unaligned_scope.length === 0 ? (
        <p>无无法对齐的范围。</p>
      ) : (
        <ul>
          {comparison.unaligned_scope.map((item) => (
            <li key={item.case_number}>
              {item.case_number}：左侧 {item.left_modules.join("、")}；右侧{" "}
              {item.right_modules.join("、")}
            </li>
          ))}
        </ul>
      )}
      <p className="prototype-inline-note">
        范围缺失或无法对齐只表示测试范围变化，不解释为通过或失败。
      </p>
      <p>
        仍有风险模块：
        {comparison.unresolved_risk_modules.join("、") || "无"}
      </p>
      <div className="prototype-trend-module-changes">
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
  );
}

function Counts({ counts }: { counts: ResultSourceCounts }) {
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
