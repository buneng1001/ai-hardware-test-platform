import { useEffect, useState } from "react";

import {
  listAutomationExecutions,
  type AutomationExecution,
} from "./automationExecutionsApi";
import {
  createFactReport,
  getFactReport,
  retryFactReportAnalysis,
  type FactReport,
} from "./factReportsApi";
import {
  getManualTestResultPage,
  type ManualTestResultBatch,
} from "./manualTestResultsApi";

export function FactReportPanel({ groupId }: { groupId: number }) {
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [batches, setBatches] = useState<ManualTestResultBatch[]>([]);
  const [executionId, setExecutionId] = useState<number | null>(null);
  const [batchIds, setBatchIds] = useState<number[]>([]);
  const [report, setReport] = useState<FactReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      listAutomationExecutions(groupId),
      getManualTestResultPage(groupId),
    ])
      .then(([automation, manual]) => {
        setExecutions(automation.items);
        setBatches(manual.batches);
      })
      .catch((error: unknown) =>
        setMessage(
          error instanceof Error ? error.message : "报告输入记录加载失败",
        ),
      );
  }, [groupId]);

  useEffect(() => {
    if (!report || report.analysis.status !== "pending") return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const refreshed = await getFactReport(report.id);
        if (cancelled) return;
        setReport(refreshed);
        if (refreshed.analysis.status === "pending" && attempts++ < 9) {
          timer = setTimeout(() => void refresh(), 1000);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "报告分析状态刷新失败",
          );
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [report?.analysis.status, report?.id]);

  const generate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setReport(
        await createFactReport(groupId, {
          automation_execution_id: executionId,
          manual_batch_ids: batchIds,
        }),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "事实报告生成失败");
    } finally {
      setBusy(false);
    }
  };

  const retryAnalysis = async () => {
    if (!report) return;
    setBusy(true);
    setMessage(null);
    try {
      setReport({
        ...report,
        analysis: await retryFactReportAnalysis(report.id),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "报告分析重试失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fact-report-panel" aria-labelledby="fact-report-title">
      <h4 id="fact-report-title">最终报告</h4>
      <p>
        选择同一测试组、同一产品版本的记录；失败、阻塞和 AI
        未配置不会阻止事实报告生成。
      </p>
      <label>
        自动化执行记录（最多一条）
        <select
          value={executionId ?? ""}
          onChange={(event) =>
            setExecutionId(
              event.target.value ? Number(event.target.value) : null,
            )
          }
        >
          <option value="">不选择自动化记录</option>
          {executions.map((item) => (
            <option key={item.id} value={item.id}>
              自动化执行 #{item.execution_number}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>人工测试记录（可多选）</legend>
        {batches.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={batchIds.includes(item.id)}
              onChange={(event) =>
                setBatchIds((current) =>
                  event.target.checked
                    ? [...current, item.id]
                    : current.filter((id) => id !== item.id),
                )
              }
            />
            批次 #{item.batch_number}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        disabled={busy || (executionId === null && batchIds.length === 0)}
        onClick={() => void generate()}
      >
        生成事实报告
      </button>
      {message && <p role="status">{message}</p>}
      {report && (
        <>
          {report.snapshot.warnings.map((warning) => (
            <p key={warning} role="status">
              {warning}
            </p>
          ))}
          <p>阶段推进结论：{report.snapshot.stage_progress.conclusion}</p>
          <p>AI 分析：{report.analysis.message}</p>
          {report.analysis.output && (
            <section aria-label="AI 分析建议">
              <p>
                AI 阶段建议：
                {report.analysis.output.stage_recommendation.suggestion}
              </p>
              <AnalysisItems
                title="高风险问题"
                items={report.analysis.output.risks}
              />
              <AnalysisItems
                title="补充验证"
                items={report.analysis.output.additional_verifications}
              />
              <AnalysisItems
                title="回归建议"
                items={report.analysis.output.regression_recommendations}
              />
            </section>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void retryAnalysis()}
          >
            重试报告分析
          </button>
          <iframe
            title="事实报告预览"
            src={`/api/fact-reports/${report.id}.html`}
          />
          <p>
            <a href={`/api/fact-reports/${report.id}.html`} download>
              下载 HTML 报告
            </a>{" "}
            ·{" "}
            <a href={`/api/fact-reports/${report.id}.txt`} download>
              下载纯文字报告
            </a>
          </p>
        </>
      )}
    </section>
  );
}

function AnalysisItems({
  title,
  items,
}: {
  title: string;
  items: { content: string }[];
}) {
  return (
    <section>
      <h5>{title}</h5>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.content}>{item.content}</li>
          ))}
        </ul>
      ) : (
        <p>无</p>
      )}
    </section>
  );
}
