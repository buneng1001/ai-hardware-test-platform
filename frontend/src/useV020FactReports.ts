import { useCallback, useEffect, useRef, useState } from "react";

import {
  listAutomationExecutions,
  type AutomationExecution,
} from "./automationExecutionsApi";
import {
  cancelFactReportAnalysis,
  cleanupReportUsedAttachments,
  createFactReport,
  deleteFactReport,
  getFactReport,
  getFactReportRepeatInfo,
  getReportAttachmentCleanupImpact,
  getReportHistory,
  listHistoricalFactReports,
  retryFactReportAnalysis,
  type FactReport,
  type HistoricalReportOption,
  type ReportAttachmentCleanupImpact,
  type ReportHistoryItem,
} from "./factReportsApi";
import { cancelAiInvocation, getActiveAiInvocation } from "./diagnosisApi";
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
  const [historicalOptions, setHistoricalOptions] = useState<
    HistoricalReportOption[]
  >([]);
  const [historicalError, setHistoricalError] = useState<string | null>(null);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
  const [report, setReport] = useState<FactReport | null>(null);
  const [cleanupImpact, setCleanupImpact] =
    useState<ReportAttachmentCleanupImpact | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestToken = useRef(0);
  const analysisReadToken = useRef(0);
  const cancellingAnalysis = useRef(false);
  const refreshingAnalysis = useRef(false);

  const load = useCallback(async (id: number) => {
    const token = requestToken.current + 1;
    requestToken.current = token;
    setStatus("loading");
    setError(null);
    try {
      const [automation, manual, reportHistory, availableHistory] =
        await Promise.all([
          listAutomationExecutions(id),
          getManualTestResultPage(id),
          getReportHistory(id),
          listHistoricalFactReports(id).catch((caught: unknown) => {
            return {
              items: [] as HistoricalReportOption[],
              error: errorMessage(caught, "历史来源加载失败"),
            };
          }),
        ]);
      if (requestToken.current !== token) return;
      setExecutions(automation.items);
      setBatches(manual.batches);
      setHistory(reportHistory.items);
      setHistoricalOptions(availableHistory.items);
      setHistoricalError(
        "error" in availableHistory ? availableHistory.error : null,
      );
      const latestId = reportIdOf(reportHistory.items);
      const latestReport =
        latestId === null ? null : await getFactReport(latestId);
      if (requestToken.current !== token) return;
      setReport(latestReport);
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
    historicalReportIds: number[] = [],
  ): Promise<boolean> => {
    if (groupId === null) return false;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const created = await createFactReport(groupId, {
        automation_execution_id: executionId,
        manual_batch_ids: manualBatchIds,
        ...(historicalReportIds.length
          ? { historical_report_ids: historicalReportIds }
          : {}),
      });
      setReport(created);
      setHistory((await getReportHistory(groupId)).items);
      setMessage(`最终报告 #${created.id} 已生成。`);
      void listHistoricalFactReports(groupId)
        .then((result) => setHistoricalOptions(result.items))
        .catch(() => undefined);
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

  /** 只重试报告分析，不重新生成事实报告或重新执行自动化。 */
  const retryAnalysis = async (
    force = false,
    overwrite = false,
    resumeChoice?: "continue" | "restart",
  ): Promise<boolean> => {
    if (!report) return false;
    setBusy(true);
    setActionError(null);
    // POST 仍在模型调用期间也允许就地停止，不能因 busy 禁用取消入口。
    setReport({
      ...report,
      analysis: { status: "pending", message: "AI 分析正在运行", output: null },
    });
    try {
      if (force) {
        const current = await getActiveAiInvocation();
        if (
          current?.operation_type === "report_analysis" &&
          current.resource_id === report.id
        ) {
          await cancelAiInvocation(current.invocation_id);
          let settled = false;
          for (let attempt = 0; attempt < 60; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 500));
            const latest = await getActiveAiInvocation();
            if (!latest || latest.invocation_id !== current.invocation_id) {
              settled = true;
              break;
            }
          }
          if (!settled)
            throw new Error("原报告 AI 分析仍在停止，请稍后主动重新执行");
        }
      }
      const analysis = await retryFactReportAnalysis(
        report.id,
        force,
        overwrite,
        resumeChoice,
      );
      setReport((current) =>
        current?.id === report.id ? { ...current, analysis } : current,
      );
      setHistoryQuery("");
      setMessage(
        analysis.reused
          ? analysis.message
          : force
            ? "已显式重新运行报告分析。"
            : "报告分析已重试，事实报告未重新生成。",
      );
      return true;
    } catch (caught) {
      try {
        const latest = await getFactReport(report.id);
        setReport((current) => (current?.id === report.id ? latest : current));
      } catch {
        /* keep the last visible state; polling can recover it */
      }
      setActionError(errorMessage(caught, "报告分析重试失败"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cancelAnalysis = async (): Promise<string> => {
    if (!report || cancellingAnalysis.current) return "";
    cancellingAnalysis.current = true;
    ++analysisReadToken.current; // 丢弃取消前已发出的旧状态查询。
    const reportId = report.id;
    const apply = (next: FactReport) =>
      setReport((current) => (current?.id === reportId ? next : current));
    try {
      let result;
      try {
        result = await cancelFactReportAnalysis(reportId);
      } catch (caught) {
        // 任务可能已在用户点击前结束。重新读取事实，不把旧界面当成运行中的任务。
        let latest: FactReport;
        try {
          latest = await getFactReport(reportId);
        } catch {
          throw caught;
        }
        apply(latest);
        if (latest.analysis.status !== "pending") {
          return "本次分析已结束，无需取消；已刷新实际结果。";
        }
        if (latest.analysis.stopping)
          return "停止请求已受理，等待当前模型请求收尾。";
        throw caught;
      }
      if (result.stopping) {
        setReport((current) =>
          current?.id === reportId && current.analysis.status === "pending"
            ? {
                ...current,
                analysis: {
                  ...current.analysis,
                  message: "AI 分析正在停止",
                  stopping: true,
                },
              }
            : current,
        );
      }
      try {
        const latest = await getFactReport(reportId);
        apply(latest);
        if (latest.analysis.status === "cancelled")
          return "本次 AI 分析已取消。";
        if (latest.analysis.status !== "pending")
          return "本次分析已结束，已刷新实际结果。";
      } catch {
        // 保留停止受理状态，后续轮询继续核实终态。
      }
      return result.stopping
        ? "停止请求已受理，等待当前模型请求返回或超时；停止完成前不能重试。"
        : "取消请求已受理，正在确认最终状态。";
    } finally {
      cancellingAnalysis.current = false;
    }
  };

  const refreshAnalysis = async () => {
    if (!report || cancellingAnalysis.current || refreshingAnalysis.current)
      return;
    refreshingAnalysis.current = true;
    const token = ++analysisReadToken.current;
    const reportId = report.id;
    try {
      const latest = await getFactReport(reportId);
      if (token === analysisReadToken.current) {
        setReport((current) => (current?.id === reportId ? latest : current));
      }
    } catch (caught) {
      if (token === analysisReadToken.current) {
        throw new Error(errorMessage(caught, "报告分析状态刷新失败"));
      }
    } finally {
      refreshingAnalysis.current = false;
    }
  };

  // The report workspace owns polling, not the preview modal. It continues when the modal closes.
  const refreshRef = useRef(refreshAnalysis);
  refreshRef.current = refreshAnalysis;
  const reportId = report?.id;
  const reportStatus = report?.analysis.status;
  useEffect(() => {
    if (reportId === undefined) return;
    const refresh = () => void refreshRef.current().catch(() => undefined);
    const onSettled = (event: Event) => {
      if (
        (event as CustomEvent<{ reportId: number }>).detail?.reportId ===
        reportId
      )
        refresh();
    };
    window.addEventListener("v030-report-task-settled", onSettled);
    const timer =
      reportStatus === "pending"
        ? window.setInterval(refresh, 2000)
        : undefined;
    return () => {
      window.removeEventListener("v030-report-task-settled", onSettled);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [reportId, reportStatus]);

  const searchHistory = async () => {
    if (groupId === null) return;
    setActionError(null);
    try {
      setHistory((await getReportHistory(groupId, historyQuery)).items);
    } catch (caught) {
      setActionError(errorMessage(caught, "报告历史查找失败"));
    }
  };

  /** 清理前先读取影响，确认后只删除当前报告已使用的原始附件。 */
  const prepareCleanup = async () => {
    if (!report) return;
    setActionError(null);
    try {
      setCleanupImpact(await getReportAttachmentCleanupImpact(report.id));
    } catch (caught) {
      setActionError(errorMessage(caught, "附件清理影响加载失败"));
    }
  };

  const confirmCleanup = async () => {
    if (!report) return;
    setBusy(true);
    setActionError(null);
    try {
      await cleanupReportUsedAttachments(report.id);
      setCleanupImpact(null);
      setReport(await getFactReport(report.id));
      setMessage("已清理当前报告使用的附件；人工文字结果和附件名称保留。");
    } catch (caught) {
      setActionError(errorMessage(caught, "附件清理失败"));
    } finally {
      setBusy(false);
    }
  };

  const deleteReport = async (): Promise<boolean> => {
    if (!report || groupId === null) return false;
    setBusy(true);
    setActionError(null);
    try {
      await deleteFactReport(report.id);
      setReport(null);
      setCleanupImpact(null);
      setHistory((await getReportHistory(groupId)).items);
      setMessage("在线报告已删除；自动化执行、人工记录和数据包不受影响。");
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught, "在线报告删除失败"));
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
    historicalOptions,
    historicalError,
    history,
    report,
    latestReportId,
    cleanupImpact,
    historyQuery,
    setHistoryQuery,
    busy,
    error,
    actionError,
    message,
    generate,
    openReport,
    getRepeatInfo: () =>
      report
        ? getFactReportRepeatInfo(report.id)
        : Promise.resolve({
            resume_available: false,
            same_input: false,
            has_previous: false,
            running_same_operation: false,
            occupied_other: false,
          }),
    retryAnalysis,
    cancelAnalysis,
    refreshAnalysis,
    searchHistory,
    prepareCleanup,
    cancelCleanup: () => setCleanupImpact(null),
    confirmCleanup,
    deleteReport,
    retry: () => (groupId !== null ? void load(groupId) : undefined),
  };
}

export type V020FactReports = ReturnType<typeof useV020FactReports>;
