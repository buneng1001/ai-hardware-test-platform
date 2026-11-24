import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAiGlobalState,
  getActiveAiInvocation,
  waitForAiInvocationFinish,
  type ActiveAiInvocation,
} from "./aiGlobalState";
import { cancelAiInvocation } from "./diagnosisApi";
import { V030RegressionResult } from "./V030RegressionResult";

import {
  listRegressionAuxiliaryReports,
  generateIntelligentRegression,
  getCurrentIntelligentRegression,
  getIntelligentRegressionRepeatInfo,
  cancelIntelligentRegression,
  type RegressionResult,
  validateRegressionAuxiliaryReports,
  type RegressionAuxiliaryReportOption,
} from "./factReportsApi";

function label(item: RegressionAuxiliaryReportOption) {
  return `${item.product_version} · ${item.test_group} · #${item.id}`;
}

/** Saved final-report inputs and the explicit, cancellable regression generation action. */
export function V030AuxiliaryReportSelector({
  reportId,
  groupId,
  analysisStatus,
}: {
  reportId: number | null;
  groupId?: number;
  analysisStatus?: string;
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
  const [result, setResult] = useState<RegressionResult | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [currentError, setCurrentError] = useState("");
  const [repeat, setRepeat] = useState<{
    ids: number[];
    activeId: string | null;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const generationPromise = useRef<Promise<void> | null>(null);
  const readEpoch = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [running, setRunning] = useState(false);
  const lock = useRef(false);
  const [activeCall, setActiveCall] = useState<ActiveAiInvocation | null>(null);
  const [gate, setGate] = useState<string>("正在检查 AI 状态");
  const [generationError, setGenerationError] = useState("");
  const [stopping, setStopping] = useState(false);
  const [invalidReportId, setInvalidReportId] = useState<number | null>(null);
  useEffect(() => {
    if (analysisStatus === undefined) return;
    let current = true;
    const refresh = async () => {
      try {
        const [state, active] = await Promise.all([
          getAiGlobalState(),
          getActiveAiInvocation(),
        ]);
        if (!current) return;
        setActiveCall(active);
        setGate(
          !state.enabled
            ? "请先开启 AI"
            : !state.can_enable
              ? state.reason || "请先验证 AI 配置"
              : active
                ? "当前有功能正在占用 AI，请稍后再试。"
                : "",
        );
      } catch {
        if (current) setGate("暂时无法确认 AI 状态");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [analysisStatus]);
  useEffect(() => {
    if (
      analysisStatus === undefined ||
      (groupId === undefined && reportId === null)
    )
      return;
    const epoch = ++readEpoch.current;
    void getCurrentIntelligentRegression(groupId, reportId)
      .then(({ project_id, result: saved }) => {
        if (mounted.current && epoch === readEpoch.current) {
          setProjectId(project_id);
          setResult(saved ?? null);
          setCurrentError("");
        }
      })
      .catch(() => {
        if (mounted.current && epoch === readEpoch.current)
          setCurrentError("当前有效建议加载失败，请刷新重试");
      });
    return () => {
      if (epoch === readEpoch.current) ++readEpoch.current;
    };
  }, [groupId, reportId, analysisStatus, activeCall?.invocation_id, running]);

  const ownCall =
    activeCall?.operation_type === "intelligent_regression" &&
    (activeCall.resource_id === reportId ||
      (projectId !== null && activeCall.project_id === projectId));
  const reason =
    reportId === null
      ? "请先生成最终测试报告"
      : analysisStatus !== "completed"
        ? "请先完成报告 AI 总体分析"
        : gate;
  const execute = async (ids: number[], force: boolean) => {
    if (reportId === null || lock.current || !mounted.current) return;
    lock.current = true;
    setRunning(true);
    setStopping(false);
    setInvalidReportId(null);
    setGenerationError("");
    try {
      const generated = await generateIntelligentRegression(
        reportId,
        ids,
        force,
      );
      if (mounted.current) {
        ++readEpoch.current;
        setResult(generated);
      }
    } catch (caught) {
      if (!mounted.current) return;
      const detail =
        caught instanceof Error ? caught.message : "智能回归生成失败";
      setGenerationError(detail);
      const match = detail.match(/报告 #(\d+)/);
      if (match && ids.includes(Number(match[1])))
        setInvalidReportId(Number(match[1]));
    } finally {
      lock.current = false;
      if (mounted.current) {
        setRunning(false);
        setStopping(false);
      }
    }
  };
  const start = (ids: number[], force: boolean) => {
    const task = execute(ids, force);
    generationPromise.current = task;
    void task.finally(() => {
      if (generationPromise.current === task) generationPromise.current = null;
    });
    return task;
  };
  const generate = async () => {
    if (
      reportId === null ||
      analysisStatus !== "completed" ||
      checking ||
      restarting ||
      (reason && !ownCall)
    )
      return;
    const ids = selected.map((item) => item.id);
    setChecking(true);
    setGenerationError("");
    try {
      const info = await getIntelligentRegressionRepeatInfo(reportId, ids);
      if (!mounted.current) return;
      if (info.occupied_other)
        setGenerationError("当前有功能正在占用 AI，请稍后再试。");
      else if (info.same_input || info.running_same_operation) {
        setRepeat({ ids, activeId: info.active_invocation_id });
      } else void start(ids, false);
    } catch (caught) {
      const detail =
        caught instanceof Error ? caught.message : "重复执行检查失败";
      setGenerationError(detail);
      const match = detail.match(/报告 #(\d+)/);
      if (match && ids.includes(Number(match[1])))
        setInvalidReportId(Number(match[1]));
    } finally {
      if (mounted.current) setChecking(false);
    }
  };
  const confirmRepeat = async () => {
    if (!repeat || restarting) return;
    const choice = repeat;
    setRepeat(null);
    setRestarting(true);
    setGenerationError("");
    try {
      if (choice.activeId) {
        const previous = choice.activeId;
        const local = generationPromise.current;
        try {
          await cancelAiInvocation(previous);
        } catch (error) {
          const current = await getActiveAiInvocation();
          if (current?.invocation_id === previous) throw error;
        }
        if (!(await waitForAiInvocationFinish(previous)))
          throw new Error("原调用尚未停止，请稍后重试");
        if (local) await local;
      }
      if (mounted.current) await start(choice.ids, true);
    } catch (caught) {
      if (mounted.current)
        setGenerationError(
          caught instanceof Error ? caught.message : "重新执行失败",
        );
    } finally {
      if (mounted.current) setRestarting(false);
    }
  };
  const cancel = async () => {
    if (stopping || restarting) return;
    setStopping(true);
    try {
      if (activeCall && ownCall)
        await cancelAiInvocation(activeCall.invocation_id);
      else if (reportId !== null) await cancelIntelligentRegression(reportId);
    } catch (caught) {
      setStopping(false);
      setGenerationError(
        caught instanceof Error ? caught.message : "停止执行失败",
      );
    }
  };

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
    if (reportId === null) {
      setOptions([]);
      setLoading(false);
      return;
    }
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
    if (reportId === null) return;
    setInvalid(false);
    setMessage("");
    try {
      await validateRegressionAuxiliaryReports(
        reportId,
        selected.map((item) => item.id),
      );
      setMessage("辅助报告选择已通过服务端校验。");
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
      {reportId !== null && (
        <>
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
                  disabled={running || ownCall}
                  onClick={() => {
                    if (invalidReportId === item.id) setInvalidReportId(null);
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
              disabled={running || ownCall}
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
                      disabled={running || ownCall}
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
        </>
      )}
      <div className="v030-regression-actions">
        {reportId !== null && (
          <button
            type="button"
            className="prototype-secondary"
            disabled={running || ownCall}
            onClick={() => void validate()}
          >
            校验辅助报告选择
          </button>
        )}
        {analysisStatus !== undefined && (
          <>
            <button
              type="button"
              className="prototype-primary"
              disabled={
                reportId === null ||
                analysisStatus !== "completed" ||
                (Boolean(reason) && !ownCall) ||
                (running && !ownCall) ||
                checking ||
                restarting ||
                Boolean(repeat) ||
                Boolean(activeCall?.stopping) ||
                invalid ||
                invalidReportId !== null
              }
              onClick={() => void generate()}
            >
              生成智能回归建议
            </button>
            {(running || ownCall) && (
              <button
                type="button"
                className="prototype-secondary"
                disabled={
                  stopping || restarting || Boolean(activeCall?.stopping)
                }
                onClick={() => void cancel()}
              >
                {stopping || activeCall?.stopping ? "正在停止…" : "停止执行"}
              </button>
            )}
            {running || ownCall ? (
              <p role="status">智能回归生成中…</p>
            ) : (
              reason && <p className="prototype-muted">{reason}</p>
            )}
            {restarting && <p role="status">正在等待原调用停止并重新执行…</p>}
            {repeat && (
              <div role="dialog" aria-label="确认重复生成智能回归建议">
                <p>
                  {repeat.activeId
                    ? "当前智能回归仍在运行。重新执行将先停止原调用并等待其结束。"
                    : "前置条件相同，生成结果可能重复。"}{" "}
                  新建议完整成功保存后才替换当前建议。
                </p>
                <button
                  type="button"
                  className="prototype-primary"
                  onClick={() => void confirmRepeat()}
                >
                  重新执行
                </button>
                <button
                  type="button"
                  className="prototype-secondary"
                  onClick={() => setRepeat(null)}
                >
                  取消
                </button>
              </div>
            )}
            {generationError && <p role="alert">{generationError}</p>}
            {invalidReportId !== null && (
              <>
                <button
                  type="button"
                  className="prototype-secondary"
                  onClick={() => {
                    setSelected((items) =>
                      items.filter((item) => item.id !== invalidReportId),
                    );
                    setInvalidReportId(null);
                    setGenerationError("已移除失效报告，请重新点击生成。");
                  }}
                >
                  移除失效报告 #{invalidReportId} 后继续
                </button>
                <button
                  type="button"
                  className="prototype-secondary"
                  onClick={() => {
                    setGenerationError("已取消本次生成，请调整辅助报告选择。");
                  }}
                >
                  取消本次生成
                </button>
              </>
            )}
          </>
        )}
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
      {currentError && <p role="alert">{currentError}</p>}
      {result && (
        <V030RegressionResult key={result.invocation_id} result={result} />
      )}
    </section>
  );
}
