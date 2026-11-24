import { useEffect, useMemo, useState } from "react";

import {
  listRegressionAuxiliaryReports,
  validateRegressionAuxiliaryReports,
  type RegressionAuxiliaryReportOption,
} from "./factReportsApi";

function label(item: RegressionAuxiliaryReportOption) {
  return `${item.product_version} · ${item.test_group} · #${item.id}`;
}

/** T14: selection and server validation only. T15 will consume the selected ids when creating AI runs. */
export function V030AuxiliaryReportSelector({
  reportId,
}: {
  reportId: number;
}) {
  const [options, setOptions] = useState<RegressionAuxiliaryReportOption[]>([]);
  const [selected, setSelected] = useState<RegressionAuxiliaryReportOption[]>(
    [],
  );
  const [keyword, setKeyword] = useState("");
  const [version, setVersion] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setSelected([]);
    setKeyword("");
    setVersion("");
    setExpanded(false);
    setLoading(true);
    setError("");
    setInvalid(false);
    setMessage("");
    void listRegressionAuxiliaryReports(reportId)
      .then(({ items }) => {
        if (active) setOptions(items);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : "辅助报告加载失败",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reportId]);

  const versions = useMemo(
    () => Array.from(new Set(options.map((item) => item.product_version))),
    [options],
  );
  const remaining = options.filter(
    (item) => !selected.some((chosen) => chosen.id === item.id),
  );
  const matched = remaining.filter(
    (item) =>
      (!version || item.product_version === version) &&
      `${item.product_version} ${item.test_group} #${item.id}`
        .toLowerCase()
        .includes(keyword.trim().toLowerCase()),
  );
  const clearFilters = () => {
    setKeyword("");
    setVersion("");
  };
  const validate = async () => {
    setInvalid(false);
    setMessage("");
    try {
      await validateRegressionAuxiliaryReports(
        reportId,
        selected.map((item) => item.id),
      );
      setMessage("辅助报告选择已通过服务端校验。实际生成将在 T15 接入。");
    } catch (caught) {
      setInvalid(true);
      setMessage(
        caught instanceof Error
          ? caught.message
          : "辅助报告已经失效，请移除后重试",
      );
    }
  };

  return (
    <section
      className="prototype-report-source-picker v030-regression-selector"
      aria-label="智能回归辅助报告"
    >
      <h4>智能回归辅助报告（可选）</h4>
      <p className="prototype-muted">
        当前报告 #{reportId}{" "}
        自动作为主报告；其他版本的有效最终报告可按需加入，不会自动选择，也不会纳入当前报告统计。
      </p>
      <div className="v030-regression-tags">
        {selected.map((item) => (
          <span className="v030-regression-tag" key={item.id}>
            {label(item)}
            <button
              type="button"
              aria-label={`移除辅助报告 #${item.id}`}
              onClick={() => {
                setSelected((current) =>
                  current.filter((chosen) => chosen.id !== item.id),
                );
                setInvalid(false);
                setMessage("");
              }}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className="prototype-secondary"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          搜索 / 选择辅助报告
        </button>
      </div>
      {expanded && (
        <div className="v030-regression-results">
          <div className="v030-regression-filters">
            <input
              aria-label="搜索辅助报告"
              placeholder="搜索版本、测试组或报告编号"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <select
              aria-label="辅助报告版本筛选"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
            >
              <option value="">全部版本</option>
              {versions.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          {loading && <p role="status">正在加载辅助报告…</p>}
          {error && <p role="alert">{error}</p>}
          {!loading && !error && !options.length && (
            <p role="status">
              当前项目暂无可选的其他最终测试报告。你仍可以仅使用当前主报告生成回归建议。
            </p>
          )}
          {!loading && !error && !!options.length && !matched.length && (
            <div>
              <p role="status">
                没有找到符合条件的报告，请调整搜索关键词或版本筛选。
              </p>
              <button
                type="button"
                className="prototype-secondary"
                onClick={clearFilters}
              >
                清除搜索和筛选
              </button>
            </div>
          )}
          {!!matched.length && (
            <div
              className="v030-regression-options"
              role="listbox"
              aria-label="辅助报告候选"
            >
              {matched.map((item) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  key={item.id}
                  onClick={() => {
                    setSelected((current) => [...current, item]);
                    setInvalid(false);
                    setMessage("");
                  }}
                >
                  {label(item)} ·{" "}
                  {item.created_at.slice(0, 16).replace("T", " ")} · AI：
                  {item.analysis_status}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="v030-regression-actions">
        <button
          type="button"
          className="prototype-secondary"
          onClick={() => void validate()}
        >
          校验辅助报告选择
        </button>
        {message && <p role={invalid ? "alert" : "status"}>{message}</p>}
        {invalid && (
          <button
            type="button"
            className="prototype-secondary"
            onClick={() => {
              setSelected([]);
              setInvalid(false);
              setMessage("");
            }}
          >
            移除失效选择
          </button>
        )}
      </div>
    </section>
  );
}
