import { useCallback, useEffect, useRef, useState } from "react";

import {
  listAutomationExecutions,
  prepareAutomationExecution,
  startAutomationExecution,
  type AutomationExecution,
  type PreparationCheck,
} from "./automationExecutionsApi";

export type ExecutionLoadStatus = "idle" | "loading" | "ready" | "error";

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * V020 冻结页面“执行与结果”的数据源。
 * 只调用既有准备检查和执行接口，维护记录、检查项和刷新状态。
 */
export function useV020AutomationExecution(groupId: number | null) {
  const [status, setStatus] = useState<ExecutionLoadStatus>("idle");
  const [records, setRecords] = useState<AutomationExecution[]>([]);
  const [checks, setChecks] = useState<PreparationCheck[] | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestToken = useRef(0);
  // 取消标记：预检返回后如果用户点了取消，就不再创建执行记录。
  const cancelledRef = useRef(false);

  const load = useCallback(async (id: number) => {
    const token = requestToken.current + 1;
    requestToken.current = token;
    setStatus("loading");
    setError(null);
    try {
      const result = await listAutomationExecutions(id);
      if (requestToken.current !== token) return;
      setRecords(result.items);
      setStatus("ready");
    } catch (caught) {
      if (requestToken.current !== token) return;
      setStatus("error");
      setError(errorMessage(caught, "自动化执行记录加载失败"));
    }
  }, []);

  useEffect(() => {
    setChecks(null);
    setReady(false);
    setMessage(null);
    setActionError(null);
    if (groupId === null) {
      requestToken.current += 1;
      setStatus("idle");
      setRecords([]);
      return;
    }
    void load(groupId);
  }, [groupId, load]);

  const prepare = async () => {
    if (groupId === null) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const preparation = await prepareAutomationExecution(groupId);
      setChecks(preparation.checks);
      setReady(preparation.passed);
      setMessage(
        preparation.passed
          ? "准备检查已通过，可以开始执行。"
          : "准备检查未通过，请按提示修复后重新检查。",
      );
    } catch (caught) {
      setActionError(errorMessage(caught, "准备检查失败"));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (groupId === null) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const record = await startAutomationExecution(groupId);
      setRecords((current) => [record, ...current]);
      setChecks(null);
      setReady(false);
      const summary = record.summary;
      setMessage(
        `自动化执行 #${record.execution_number} 已完成：` +
          `通过 ${summary.passed} · 失败 ${summary.failed} · ` +
          `阻塞 ${summary.blocked} · 未执行 ${summary.not_executed}。`,
      );
    } catch (caught) {
      setActionError(errorMessage(caught, "自动化执行失败"));
    } finally {
      setBusy(false);
    }
  };

  /** 一键执行：先自动预检，通过就立即开始，不再让用户点第二次。 */
  const run = async () => {
    if (groupId === null) return;
    const startedAt = Date.now();
    cancelledRef.current = false;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    setChecks(null);
    try {
      const preparation = await prepareAutomationExecution(groupId);
      setChecks(preparation.checks);
      if (cancelledRef.current) {
        setMessage("已取消本次测试，未创建执行记录。");
        return;
      }
      if (!preparation.passed) {
        setReady(false);
        setMessage("预检未通过，请按提示修复后再执行。");
        return;
      }
      setReady(true);
      const record = await startAutomationExecution(groupId);
      setRecords((current) => [record, ...current]);
      setChecks(null);
      setReady(false);
      const summary = record.summary;
      setMessage(
        `执行完成：通过 ${summary.passed} · 失败 ${summary.failed} · ` +
          `阻塞 ${summary.blocked} · 未执行 ${summary.not_executed}。`,
      );
    } catch (caught) {
      setActionError(errorMessage(caught, "执行失败"));
    } finally {
      // 执行本身很快，至少让“执行中”状态出现 700ms，避免按钮闪一下就恢复。
      const remain = 700 - (Date.now() - startedAt);
      if (remain > 0) {
        await new Promise((resolve) => setTimeout(resolve, remain));
      }
      setBusy(false);
    }
  };

  /** 取消本次测试：预检后不再开始，或结束当前等待。 */
  const cancelRun = () => {
    cancelledRef.current = true;
    if (!busy) setMessage("已取消本次测试，未创建执行记录。");
  };

  const cancelPreparation = () => {
    setChecks(null);
    setReady(false);
    setMessage("已取消准备流程，未创建正式执行记录。");
  };

  const refresh = () => {
    if (groupId !== null) void load(groupId);
  };

  return {
    status,
    records,
    checks,
    ready,
    busy,
    error,
    actionError,
    message,
    prepare,
    execute,
    run,
    cancelRun,
    cancelPreparation,
    refresh,
    retry: refresh,
  };
}

export type V020AutomationExecution = ReturnType<
  typeof useV020AutomationExecution
>;
