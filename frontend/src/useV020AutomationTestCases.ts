import { useCallback, useEffect, useRef, useState } from "react";

import {
  convertSourceTestCasesWithRules,
  listAutomationTestCases,
  type AutomationTestCase,
} from "./automationTestCasesApi";

export type AutomationCaseLoadStatus = "idle" | "loading" | "ready" | "error";

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * V020 冻结页面“自动化用例表”的数据源。
 * 只调用既有规则转换接口，维护加载、空、失败、重试和生成结果状态。
 */
export function useV020AutomationTestCases(productVersionId: number | null) {
  const [status, setStatus] = useState<AutomationCaseLoadStatus>("idle");
  const [items, setItems] = useState<AutomationTestCase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 请求序号用于丢弃切换版本后返回的旧响应。
  const requestToken = useRef(0);

  const reload = useCallback(async (versionId: number) => {
    const token = requestToken.current + 1;
    requestToken.current = token;
    setStatus("loading");
    setError(null);
    setActionError(null);
    setMessage(null);
    try {
      const result = await listAutomationTestCases(versionId);
      if (requestToken.current !== token) return;
      setItems(result.items);
      setStatus("ready");
    } catch (caught) {
      if (requestToken.current !== token) return;
      setStatus("error");
      setError(errorMessage(caught, "自动化用例加载失败"));
    }
  }, []);

  useEffect(() => {
    setItems([]);
    setMessage(null);
    setActionError(null);
    if (productVersionId === null) {
      requestToken.current += 1;
      setStatus("idle");
      setError(null);
      return;
    }
    void reload(productVersionId);
  }, [productVersionId, reload]);

  /** 规则转换只处理尚未生成候选的原始用例，不覆盖已有人工修改。 */
  const convert = async () => {
    if (productVersionId === null) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const result = await convertSourceTestCasesWithRules(productVersionId);
      setItems(result.items);
      setStatus("ready");
      setMessage(
        result.created_count > 0
          ? `已生成 ${result.created_count} 条规则候选，均需人工审核。`
          : "没有新的原始用例需要转换；已有候选不会被覆盖。",
      );
    } catch (caught) {
      setActionError(errorMessage(caught, "规则转换失败"));
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    if (productVersionId !== null) void reload(productVersionId);
  };

  return {
    status,
    items,
    error,
    actionError,
    message,
    busy,
    retry,
    convert,
  };
}

export type V020AutomationTestCases = ReturnType<
  typeof useV020AutomationTestCases
>;
