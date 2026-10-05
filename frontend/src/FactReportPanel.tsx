import { useEffect, useState } from "react";

import {
  listAutomationExecutions,
  type AutomationExecution,
} from "./automationExecutionsApi";
import { createFactReport, type FactReport } from "./factReportsApi";
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
          <p>AI 区域状态：{report.snapshot.ai_analysis.message}</p>
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
