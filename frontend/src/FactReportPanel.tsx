import { useEffect, useState } from "react";

import {
  listAutomationExecutions,
  type AutomationExecution,
} from "./automationExecutionsApi";
import {
  createFactReport,
  cleanupReportUsedAttachments,
  deleteFactReport,
  getFactReport,
  getReportAttachmentCleanupImpact,
  getReportHistory,
  retryFactReportAnalysis,
  type FactReport,
  type ReportAttachmentCleanupImpact,
  type ReportHistoryItem,
} from "./factReportsApi";
import {
  getManualTestResultPage,
  type ManualTestResultBatch,
} from "./manualTestResultsApi";
import { FactReportView } from "./FactReportView";
import { ReportHistory } from "./ReportHistory";

export function FactReportPanel({ groupId }: { groupId: number }) {
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [batches, setBatches] = useState<ManualTestResultBatch[]>([]);
  const [executionId, setExecutionId] = useState<number | null>(null);
  const [batchIds, setBatchIds] = useState<number[]>([]);
  const [report, setReport] = useState<FactReport | null>(null);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [cleanupImpact, setCleanupImpact] =
    useState<ReportAttachmentCleanupImpact | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      listAutomationExecutions(groupId),
      getManualTestResultPage(groupId),
      getReportHistory(groupId),
    ])
      .then(async ([automation, manual, reportHistory]) => {
        setExecutions(automation.items);
        setBatches(manual.batches);
        setHistory(reportHistory.items);
        const activeReport = reportHistory.items.find(
          (item) =>
            item.record_type === "fact_report" && item.status !== "superseded",
        );
        if (activeReport) setReport(await getFactReport(activeReport.id));
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
      const created = await createFactReport(groupId, {
        automation_execution_id: executionId,
        manual_batch_ids: batchIds,
      });
      setReport(created);
      setCleanupImpact(null);
      setHistory((await getReportHistory(groupId)).items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "事实报告生成失败");
    } finally {
      setBusy(false);
    }
  };

  const searchHistory = async () => {
    try {
      setHistory((await getReportHistory(groupId, historyQuery)).items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "历史记录加载失败");
    }
  };

  const prepareCleanup = async () => {
    if (!report) return;
    try {
      setCleanupImpact(await getReportAttachmentCleanupImpact(report.id));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "附件清理影响加载失败",
      );
    }
  };

  const cleanupAttachments = async () => {
    if (!report) return;
    setBusy(true);
    try {
      await cleanupReportUsedAttachments(report.id);
      setReport(await getFactReport(report.id));
      setCleanupImpact(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "附件清理失败");
    } finally {
      setBusy(false);
    }
  };

  const removeReport = async () => {
    if (
      !report ||
      !window.confirm(
        "删除在线报告不会删除自动化、人工记录或数据包。是否继续？",
      )
    )
      return;
    setBusy(true);
    try {
      await deleteFactReport(report.id);
      setReport(null);
      setCleanupImpact(null);
      setHistory((await getReportHistory(groupId)).items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除在线报告失败");
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
        <FactReportView
          report={report}
          cleanupImpact={cleanupImpact}
          busy={busy}
          onPrepareCleanup={() => void prepareCleanup()}
          onCleanup={() => void cleanupAttachments()}
          onRetryAnalysis={() => void retryAnalysis()}
          onDelete={() => void removeReport()}
        />
      )}
      <ReportHistory
        items={history}
        query={historyQuery}
        onQueryChange={setHistoryQuery}
        onSearch={() => void searchHistory()}
      />
    </section>
  );
}
