import { useCallback, useEffect, useRef, useState } from "react";

import {
  createManualTestResultBatch,
  deleteManualTestAttachment,
  deleteManualTestResult,
  getManualTestResultPage,
  saveManualTestResultBatch,
  type ManualTestResultBatch,
  type ManualTestResultCommand,
  type ManualTestResultPage,
} from "./manualTestResultsApi";
import {
  draftsFor,
  type ManualTestResultDraft,
} from "./manualTestResultDrafts";

export type ManualResultLoadStatus = "idle" | "loading" | "ready" | "error";

async function attachmentCommand(file: File | null) {
  if (!file) return undefined;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(new Error("附件读取失败"));
    reader.readAsDataURL(file);
  });
  return {
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    content_base64: data,
  };
}

/**
 * V020 冻结页面“人工测试结果”的数据源。
 * 复用既有批次保存、修改、删除和附件接口，维护恢复编辑和加载状态。
 */
export function useV020ManualTestResults(groupId: number | null) {
  const [status, setStatus] = useState<ManualResultLoadStatus>("idle");
  const [page, setPage] = useState<ManualTestResultPage | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, ManualTestResultDraft>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestToken = useRef(0);

  const applyBatch = (
    nextPage: ManualTestResultPage,
    batch: ManualTestResultBatch | undefined,
  ) => {
    setPage(nextPage);
    setBatchId(batch?.id ?? null);
    setDrafts(draftsFor(nextPage, batch));
  };

  const load = useCallback(async (id: number) => {
    const token = requestToken.current + 1;
    requestToken.current = token;
    setStatus("loading");
    setError(null);
    try {
      const loaded = await getManualTestResultPage(id);
      if (requestToken.current !== token) return;
      applyBatch(loaded, loaded.batches[0]);
      setStatus("ready");
    } catch (caught) {
      if (requestToken.current !== token) return;
      setStatus("error");
      setError(
        caught instanceof Error ? caught.message : "人工测试结果加载失败",
      );
    }
  }, []);

  useEffect(() => {
    setMessage(null);
    setActionError(null);
    if (groupId === null) {
      requestToken.current += 1;
      setStatus("idle");
      setPage(null);
      setDrafts({});
      return;
    }
    void load(groupId);
  }, [groupId, load]);

  const selectBatch = (nextId: number) => {
    const batch = page?.batches.find((item) => item.id === nextId);
    if (!page || !batch) return;
    applyBatch(page, batch);
  };

  const newBatch = () => {
    if (!page) return;
    setBatchId(null);
    setDrafts(draftsFor(page, undefined));
    setMessage("已新建未保存的记录批次。");
  };

  const updateDraft = (
    caseId: number,
    change: Partial<ManualTestResultDraft>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [caseId]: { ...current[caseId], ...change },
    }));
  };

  const commandFor = async (
    sourceCaseId: number,
  ): Promise<ManualTestResultCommand> => {
    const draft = drafts[sourceCaseId];
    const attachment = await attachmentCommand(draft.attachment);
    return {
      source_test_case_id: sourceCaseId,
      status: draft.status,
      actual_result: draft.actualResult.trim() || null,
      notes: draft.notes.trim() || null,
      executed_at: draft.executedAt
        ? new Date(draft.executedAt).toISOString()
        : null,
      ...(attachment ? { attachments: [attachment] } : {}),
    };
  };

  const save = async (caseIds: number[]) => {
    if (groupId === null || !page || caseIds.length === 0) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const commands = await Promise.all(caseIds.map(commandFor));
      const saved =
        batchId === null
          ? await createManualTestResultBatch(groupId, commands)
          : await saveManualTestResultBatch(batchId, commands);
      const nextPage = {
        ...page,
        batches: [
          saved,
          ...page.batches.filter((item) => item.id !== saved.id),
        ],
      };
      applyBatch(nextPage, saved);
      setMessage(caseIds.length === 1 ? "当前行已保存。" : "当前批次已保存。");
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "人工结果保存失败",
      );
    } finally {
      setBusy(false);
    }
  };

  const removeResult = async (resultId: number) => {
    if (groupId === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteManualTestResult(resultId);
      await load(groupId);
      setMessage("人工结果已删除；相关报告将在生成后标记为过期。");
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "人工结果删除失败",
      );
    } finally {
      setBusy(false);
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    if (groupId === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteManualTestAttachment(attachmentId);
      await load(groupId);
      setMessage("附件已删除。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "附件删除失败");
    } finally {
      setBusy(false);
    }
  };

  return {
    status,
    page,
    batchId,
    drafts,
    busy,
    error,
    actionError,
    message,
    selectBatch,
    newBatch,
    updateDraft,
    save,
    removeResult,
    removeAttachment,
    retry: () => (groupId !== null ? void load(groupId) : undefined),
  };
}

export type V020ManualTestResults = ReturnType<typeof useV020ManualTestResults>;
