import { useCallback, useEffect, useRef, useState } from "react";

import {
  listAutomationExecutions,
  type AutomationExecution,
} from "./automationExecutionsApi";
import {
  createFactReport,
  getFactReport,
  getReportHistory,
  type FactReport,
  type ReportHistoryItem,
} from "./factReportsApi";
import {
  getManualTestResultPage,
  type ManualTestResultBatch,
} from "./manualTestResultsApi";

export type ReportLoadStatus = "idle" | "loading" | "ready" | "error";

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

function reportIdOf(items: ReportHistoryItem[]): number | null {
  const latest = items.find(
    (item) =>
      item.record_type === "fact_report" && item.status !== "superseded",
  );
  return latest?.id ?? null;
}

/**
 * V020 冻结页面“最终报告”的数据源。
 * 只调用既有执行、人工批次、报告历史和事实报告接口。
 */
export function useV020FactReports(groupId: number | null) {
  const [status, setStatus] = useState<ReportLoadStatus>("idle");
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [batches, setBatches] = useState<ManualTestResultBatch[]>([]);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
  const [report, setReport] = useState<FactReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestToken = useRef(0);

  const load = useCallback(async (id: number) => {
    const token = requestToken.current + 1;
    requestToken.current = token;
    setStatus("loading");
    setError(null);
    try {
      const [automation, manual, reportHistory] = await Promise.all([
        listAutomationExecutions(id),
        getManualTestResultPage(id),
        getReportHistory(id),
      ]);
      if (requestToken.current !== token) return;
      setExecutions(automation.items);
      setBatches(manual.batches);
      setHistory(reportHistory.items);
      const latestId = reportIdOf(reportHistory.items);
      setReport(latestId === null ? null : await getFactReport(latestId));
      if (requestToken.current !== token) return;
      setStatus("ready");
    } catch (caught) {
      if (requestToken.current !== token) return;
      setStatus("error");
      setError(errorMessage(caught, "最终报告加载失败"));
    }
  }, []);

  useEffect(() => {
    setReport(null);
    setMessage(null);
    setActionError(null);
    if (groupId === null) {
      requestToken.current += 1;
      setStatus("idle");
      return;
    }
    void load(groupId);
  }, [groupId, load]);

  const generate = async (
    executionId: number | null,
    manualBatchIds: number[],
  ): Promise<boolean> => {
    if (groupId === null) return false;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const created = await createFactReport(groupId, {
        automation_execution_id: executionId,
        manual_batch_ids: manualBatchIds,
      });
      setReport(created);
      setHistory((await getReportHistory(groupId)).items);
      setMessage(`最终报告 #${created.id} 已生成。`);
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught, "事实报告生成失败"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openReport = async (reportId: number): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      setReport(await getFactReport(reportId));
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught, "报告内容加载失败"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reports = history.filter((item) => item.record_type === "fact_report");
  const latestReportId = reportIdOf(history);

  return {
    status,
    executions,
    batches,
    reports,
    report,
    latestReportId,
    busy,
    error,
    actionError,
    message,
    generate,
    openReport,
    retry: () => (groupId !== null ? void load(groupId) : undefined),
  };
}

export type V020FactReports = ReturnType<typeof useV020FactReports>;
