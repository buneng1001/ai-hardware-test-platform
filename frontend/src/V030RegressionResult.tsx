import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getFactReport, type RegressionResult } from "./factReportsApi";
import "./V030RegressionResult.css";

const priorityLabels: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function V030RegressionResult({ result }: { result: RegressionResult }) {
  const [module, setModule] = useState("");
  const [caseType, setCaseType] = useState("");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const allBox = useRef<HTMLInputElement>(null);
  const modules = useMemo(
    () => [...new Set(result.candidates.map((item) => item.module))].sort(),
    [result.candidates],
  );
  const matched = result.candidates.filter(
    (item) =>
      (!module || item.module === module) &&
      (!caseType || item.case_type === caseType),
  );
  const allMatched =
    matched.length > 0 && matched.every((item) => selected.has(item.id));
  const someMatched = matched.some((item) => selected.has(item.id));
  useEffect(() => {
    if (allBox.current)
      allBox.current.indeterminate = someMatched && !allMatched;
  }, [someMatched, allMatched]);
  const selectMatched = (checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const item of matched)
        checked ? next.add(item.id) : next.delete(item.id);
      return next;
    });
  const invert = () =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const item of matched)
        next.has(item.id) ? next.delete(item.id) : next.add(item.id);
      return next;
    });
  const toggle = (id: number, checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  const toggleExpanded = (id: number) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const [sourceBusy, setSourceBusy] = useState<number | null>(null);
  const [sourceError, setSourceError] = useState<{
    id: number;
    message: string;
  } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sourceButton = useRef<HTMLButtonElement | null>(null);
  const sourceSequence = useRef(0);
  useEffect(
    () => () => {
      ++sourceSequence.current;
    },
    [],
  );
  const openSource = async (id: number, button: HTMLButtonElement) => {
    const sequence = ++sourceSequence.current;
    sourceButton.current = button;
    setSourceBusy(id);
    setSourceError(null);
    try {
      const report = await getFactReport(id);
      if (!report || report.id !== id || !report.snapshot)
        throw new Error("invalid report");
      if (sequence === sourceSequence.current) setPreview(id);
    } catch {
      if (sequence === sourceSequence.current)
        setSourceError({
          id,
          message: `报告 #${id} 不存在、不可访问或加载失败；原关联发现仍保留。`,
        });
    } finally {
      if (sequence === sourceSequence.current) setSourceBusy(null);
    }
  };
  const closePreview = () => {
    setPreview(null);
    sourceButton.current?.focus();
  };
  useEffect(() => {
    if (preview !== null) closeButton.current?.focus();
  }, [preview]);
  const sections = [
    ["总体风险判断", result.overall_risk.content],
    [
      "重点变化",
      result.key_changes?.content ??
        "未选择辅助报告，仅分析主报告，不进行跨版本比较。",
    ],
    ["回归重点", result.regression_focus.content],
    ["建议总结", result.summary],
  ] as const;

  return (
    <section aria-label="智能回归生成结果" className="v030-regression-current">
      <header className="v030-regression-heading">
        <h4>智能回归分析 {result.is_mock ? "（Mock）" : ""}</h4>
        <p className="prototype-muted">
          当前有效建议 · 主报告 #{result.main_report_id}
          {result.generated_at
            ? ` · ${result.generated_at.slice(0, 19).replace("T", " ")}`
            : ""}
        </p>
      </header>
      <div className="v030-regression-analysis">
        {sections.map(([title, content]) => (
          <article key={title}>
            <h5>{title}</h5>
            <p>{content}</p>
          </article>
        ))}
      </div>
      <div className="v030-regression-table-heading">
        <h4>结构化回归用例</h4>
        <p className="prototype-muted" aria-live="polite">
          建议总数 {result.candidates.length} · 当前命中 {matched.length} · 已选{" "}
          {selected.size}
        </p>
      </div>
      <div
        className="v030-regression-case-controls"
        aria-label="回归用例筛选和批量选择"
      >
        <label>
          模块
          <select
            aria-label="回归用例模块筛选"
            value={module}
            onChange={(event) => setModule(event.target.value)}
          >
            <option value="">全部模块</option>
            {modules.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          执行方式
          <select
            aria-label="回归用例执行方式筛选"
            value={caseType}
            onChange={(event) => setCaseType(event.target.value)}
          >
            <option value="">全部方式</option>
            <option value="manual">人工</option>
            <option value="automation">自动化</option>
          </select>
        </label>
        <button
          type="button"
          className="prototype-secondary"
          disabled={!matched.length}
          onClick={() => selectMatched(true)}
        >
          全选当前筛选结果
        </button>
        <button
          type="button"
          className="prototype-secondary"
          disabled={!matched.length}
          onClick={invert}
        >
          反选当前筛选结果
        </button>
        <button
          type="button"
          className="prototype-secondary"
          disabled={!selected.size}
          onClick={() => setSelected(new Set())}
        >
          清空选择
        </button>
      </div>
      <div
        className="v030-regression-table-scroll"
        role="region"
        aria-label="回归用例表格滚动区域"
        tabIndex={0}
      >
        <table className="v030-regression-table" aria-label="结构化回归候选">
          <colgroup>
            <col className="v030-regression-col-check" />
            <col className="v030-regression-col-title" />
            <col className="v030-regression-col-type" />
            <col className="v030-regression-col-module" />
            <col className="v030-regression-col-priority" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <input
                  ref={allBox}
                  type="checkbox"
                  aria-label="全选当前筛选结果"
                  checked={allMatched}
                  disabled={!matched.length}
                  onChange={(event) => selectMatched(event.target.checked)}
                />
              </th>
              <th scope="col">用例标题</th>
              <th scope="col">执行方式</th>
              <th scope="col">模块</th>
              <th scope="col">优先级</th>
              <th scope="col">回归原因</th>
            </tr>
          </thead>
          <tbody>
            {matched.length === 0 ? (
              <tr>
                <td colSpan={6} className="v030-regression-empty">
                  没有符合当前筛选条件的回归用例。
                </td>
              </tr>
            ) : (
              matched.map((item) => {
                const open = expanded.has(item.id);
                return (
                  <Fragment key={item.id}>
                    <tr
                      className={
                        selected.has(item.id)
                          ? "v030-regression-row-selected"
                          : undefined
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择 ${item.title}`}
                          checked={selected.has(item.id)}
                          onChange={(event) =>
                            toggle(item.id, event.target.checked)
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="v030-regression-link"
                          aria-expanded={open}
                          onClick={() => toggleExpanded(item.id)}
                        >
                          {item.title}
                          <span
                            aria-hidden="true"
                            className="v030-regression-chevron"
                          >
                            {open ? "▾" : "▸"}
                          </span>
                        </button>
                      </td>
                      <td>{item.case_type === "manual" ? "人工" : "自动化"}</td>
                      <td>{item.module}</td>
                      <td>{priorityLabels[item.priority] ?? item.priority}</td>
                      <td>{item.reason}</td>
                    </tr>
                    {open && (
                      <tr className="v030-regression-detail-row">
                        <td colSpan={6}>
                          <section
                            className="v030-regression-detail"
                            aria-label={`${item.title} 详情`}
                          >
                            <div className="v030-regression-detail-grid">
                              {(
                                [
                                  ["前置条件", item.preconditions],
                                  ["测试输入", item.input],
                                  ["测试步骤", item.steps],
                                  ["预期结果", item.expected_result],
                                ] as const
                              ).map(([label, value]) => (
                                <div key={label}>
                                  <h5>{label}</h5>
                                  <p>{value}</p>
                                </div>
                              ))}
                            </div>
                            <h5>来源依据</h5>
                            <div className="v030-regression-evidence">
                              {item.source_findings.map((source, index) => (
                                <article
                                  key={`${source.report_id}:${source.evidence_ref}:${index}`}
                                >
                                  <div>
                                    <span className="prototype-muted">
                                      来源报告
                                    </span>
                                    <button
                                      type="button"
                                      className="v030-regression-link"
                                      disabled={sourceBusy !== null}
                                      onClick={(event) =>
                                        void openSource(
                                          source.report_id,
                                          event.currentTarget,
                                        )
                                      }
                                    >
                                      报告 #{source.report_id} ·{" "}
                                      {source.product_version}
                                      {sourceBusy === source.report_id
                                        ? "（加载中）"
                                        : ""}
                                    </button>
                                  </div>
                                  <div>
                                    <span className="prototype-muted">
                                      关联发现
                                    </span>
                                    <p>{source.finding}</p>
                                  </div>
                                  <div>
                                    <span className="prototype-muted">
                                      推荐原因
                                    </span>
                                    <p>{item.reason}</p>
                                  </div>
                                  {sourceError?.id === source.report_id && (
                                    <p
                                      role="alert"
                                      className="v030-regression-source-error"
                                    >
                                      {sourceError.message}
                                    </p>
                                  )}
                                </article>
                              ))}
                            </div>
                          </section>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {preview !== null && (
        <div
          className="v030-regression-preview-overlay"
          onKeyDown={(event) => {
            if (event.key === "Escape") closePreview();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`来源报告 #${preview} 预览`}
            className="v030-regression-preview"
          >
            <header>
              <strong>来源报告 #{preview} · 只读预览</strong>
              <button
                ref={closeButton}
                className="prototype-secondary"
                type="button"
                onClick={closePreview}
              >
                关闭报告预览
              </button>
            </header>
            <iframe
              title={`报告 #${preview} HTML`}
              src={`/api/fact-reports/${preview}.html`}
              sandbox=""
            />
          </section>
        </div>
      )}
    </section>
  );
}
