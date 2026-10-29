import { useCallback, useEffect, useRef, useState } from "react";

import {
  convertSourceTestCasesWithRules,
  createAutomationTestCase,
  deleteAutomationTestCase,
  listAutomationTestCases,
  regenerateAutomationTestCase,
  submitAutomationCaseFeedback,
  updateAutomationTestCase,
  validateAutomationTestCases,
  type AutomationCaseCreateCommand,
  type AutomationTestCase,
  type AutomationTestCaseDraft,
} from "./automationTestCasesApi";

export type AutomationCaseLoadStatus = "idle" | "loading" | "ready" | "error";

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * V020 冻结页面“自动化用例表”的数据源。
 * 只调用既有自动化用例接口，维护加载、生成、编辑、反馈、校验和删除状态。
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

  const replaceCase = (saved: AutomationTestCase) => {
    setItems((current) =>
      current.map((item) => (item.id === saved.id ? saved : item)),
    );
  };

  const runCaseAction = async (
    action: () => Promise<AutomationTestCase>,
    successMessage: string,
    failureMessage: string,
  ): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      replaceCase(await action());
      setMessage(successMessage);
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught, failureMessage));
      return false;
    } finally {
      setBusy(false);
    }
  };

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

  const updateCase = (caseId: number, draft: AutomationTestCaseDraft) => {
    if (productVersionId === null) return Promise.resolve(false);
    return runCaseAction(
      () => updateAutomationTestCase(productVersionId, caseId, draft),
      "修改已保存，当前用例已变为未校验。",
      "自动化用例保存失败",
    );
  };

  const regenerateCase = (caseId: number) => {
    if (productVersionId === null) return Promise.resolve(false);
    return runCaseAction(
      () => regenerateAutomationTestCase(productVersionId, caseId),
      "已按当前原始用例重新生成，当前用例已变为未校验。",
      "自动化用例重新生成失败",
    );
  };

  const createCase = async (
    command: AutomationCaseCreateCommand,
  ): Promise<boolean> => {
    if (productVersionId === null) return false;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const saved = await createAutomationTestCase(productVersionId, command);
      setItems((current) => [...current, saved]);
      setMessage("已新增自动化用例，尚未校验。");
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught, "自动化用例新增失败"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deleteCase = async (caseId: number): Promise<boolean> => {
    if (productVersionId === null) return false;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await deleteAutomationTestCase(productVersionId, caseId);
      setItems((current) => current.filter((item) => item.id !== caseId));
      setMessage("自动化用例已删除；历史快照不受此操作影响。");
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught, "自动化用例删除失败"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const validateCases = async (): Promise<boolean> => {
    if (productVersionId === null) return false;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const result = await validateAutomationTestCases(productVersionId);
      setItems(result.items);
      setMessage(
        result.valid
          ? "自动化用例校验通过。"
          : "存在未通过校验的自动化用例，不能加入测试组或执行。",
      );
      return result.valid;
    } catch (caught) {
      setActionError(errorMessage(caught, "自动化用例校验失败"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** 无可用适配器时保留用户输入并记录不可用状态，不伪造 AI 返回。 */
  const submitFeedback = async (
    caseId: number,
    feedback: string,
  ): Promise<boolean> => {
    if (productVersionId === null) return false;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await submitAutomationCaseFeedback(productVersionId, caseId, feedback);
      setItems((current) =>
        current.map((item) =>
          item.id === caseId
            ? { ...item, feedback_input: "", feedback_status: "accepted" }
            : item,
        ),
      );
      setMessage("AI 反馈已提交。");
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught, "AI 反馈提交失败"));
      setItems((current) =>
        current.map((item) =>
          item.id === caseId
            ? {
                ...item,
                feedback_input: feedback,
                feedback_status: "unavailable",
              }
            : item,
        ),
      );
      return false;
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
    updateCase,
    regenerateCase,
    createCase,
    deleteCase,
    validateCases,
    submitFeedback,
  };
}

export type V020AutomationTestCases = ReturnType<
  typeof useV020AutomationTestCases
>;
