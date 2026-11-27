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
  if (result.generation_status === "legacy_incomplete" || !result.analysis_sections) {
    return (
      <section aria-label="旧版智能回归结果" className="v030-regression-current">
        <header className="v030-regression-heading">
          <h4>历史建议需要重新生成</h4>
          <p role="alert">这份建议由旧版流程生成，尚未完成当前版本的回归分析，暂不可应用。请重新生成智能回归建议。</p>
        </header>
      </section>
    );
  }

  const sections = [
    ["01 回归必要性与范围判断", result.analysis_sections.regression_necessity],
    ["02 影响链路与风险分析", result.analysis_sections.impact_analysis],
    ["03 回归策略与执行顺序", result.analysis_sections.execution_strategy],
    ["04 执行准备与验收边界", result.analysis_sections.execution_readiness],
  ] as const;
  const existingRecommendations = result.existing_case_recommendations ?? [];
  const evidenceButtons = (refs: { report_id: number; evidence_ref: string }[]) => (
    <div className="v030-regression-source-list" aria-label="分析证据来源">
      {[...new Set(refs.map((item) => item.report_id))].map((id) => (
        <button
          key={id}
          type="button"
          className="v030-regression-link"
          disabled={sourceBusy !== null}
          onClick={(event) => void openSource(id, event.currentTarget)}
        >
          查看报告 #{id}
        </button>
      ))}
    </div>
  );

  return (
    <section aria-label="智能回归生成结果" className="v030-regression-current">
      <header className="v030-regression-heading">
        <h4>智能回归方案 {result.is_mock ? "（Mock）" : "（AI 分析）"}</h4>
        <p className="prototype-muted">
          当前有效建议 · 主报告 #{result.main_report_id}
          {result.generated_at
            ? " · " + result.generated_at.slice(0, 19).replace("T", " ")
            : ""}
        </p>
        <p className="prototype-muted">
          基于冻结报告事实、产品画像、版本上下文及原用例定义独立分析生成；管理层最终测试报告仍由「最终测试报告」模块负责。
        </p>
      </header>
      <div className="v030-regression-analysis">        {sections.map(([title, section]) => (
          <article key={title}>
            <h5>{title}</h5>
            <p>{section.content}</p>
            {evidenceButtons(section.evidence_refs)}
          </article>
        ))}
        {result.key_changes && (
          <article>
            <h5>辅助报告事实对照</h5>
            <p>{result.key_changes.content}</p>
            {evidenceButtons(result.key_changes.evidence_refs)}
          </article>
        )}
        {result.review_notes.length > 0 && (
          <article>
            <h5>评审提示</h5>
            <ul>
              {result.review_notes.map((note, index) => (
                <li key={index}>
                  <p>{note.content}</p>
                  {evidenceButtons(note.source_findings)}
                </li>
              ))}
            </ul>
          </article>
        )}
        {result.deferred_targets.length > 0 && (
          <article>
            <h5>暂不生成的回归目标</h5>
            <p>以下覆盖缺口因缺少可验证条件或预期结果，未被伪装成可执行用例。</p>
            <ul>
              {result.deferred_targets.map((item, index) => (
                <li key={index}>
                  <strong>{item.module} · {item.title}</strong>
                  <p>{item.reason}</p>
                  {evidenceButtons(item.source_findings)}
                </li>
              ))}
            </ul>
          </article>
        )}
        <article>
          <h5>分析总结</h5>
          <p>{result.summary}</p>
        </article>
      </div>
      {existingRecommendations.length > 0 && (
        <section className="v030-regression-existing" aria-label="已有用例复测建议">
          <div className="v030-regression-table-heading">
            <h4>优先复测已有用例</h4>
            <p className="prototype-muted">
              {existingRecommendations.length} 条报告已关联的原用例；直接复测，不创建重复用例。
            </p>
          </div>
          <div className="v030-regression-table-scroll" role="region" aria-label="已有用例复测建议表格" tabIndex={0}>
            <table className="v030-regression-table" aria-label="已有用例复测建议">
              <thead>
                <tr>
                  <th>用例编号</th>
                  <th>用例名称</th>
                  <th>模块</th>
                  <th>优先级</th>
                  <th>建议原因</th>
                  <th>来源报告</th>
                </tr>
              </thead>
              <tbody>
                {existingRecommendations.map((item) => (
                  <tr key={`${item.module}:${item.case_number}`}>
                    <td>{item.case_number}</td>
                    <td>{item.title}</td>
                    <td>{item.module}</td>
                    <td>{priorityLabels[item.priority] ?? item.priority}</td>
                    <td>{item.reason}</td>
                    <td>
                      {item.source_findings.map((source, index) => (
                        <button
                          key={`${source.report_id}:${source.evidence_ref}:${index}`}
                          type="button"
                          className="v030-regression-link"
                          disabled={sourceBusy !== null}
                          onClick={(event) => void openSource(source.report_id, event.currentTarget)}
                        >
                          报告 #{source.report_id} · {source.product_version}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="v030-regression-table-heading">
        <h4>新增结构化回归用例</h4>
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
            <col className="v030-regression-col-test-type" />
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
              <th scope="col">测试类型</th>
              <th scope="col">执行方式</th>
              <th scope="col">模块</th>
              <th scope="col">优先级</th>
              <th scope="col">回归原因</th>
            </tr>
          </thead>
          <tbody>
            {matched.length === 0 ? (
              <tr>
                <td colSpan={7} className="v030-regression-empty">
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
                      <td>{item.test_type}</td>
                      <td>{item.case_type === "manual" ? "人工" : "自动化"}</td>
                      <td>{item.module}</td>
                      <td>{priorityLabels[item.priority] ?? item.priority}</td>
                      <td>{item.reason}</td>
                    </tr>
                    {open && (
                      <tr className="v030-regression-detail-row">
                        <td colSpan={7}>
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
