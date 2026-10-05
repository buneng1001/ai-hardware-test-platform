import { useEffect, useState } from "react";

import { ManualTestResultRow } from "./ManualTestResultRow";
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

export function ManualTestResultsPanel({
  groupId,
  onBack,
}: {
  groupId: number;
  onBack: () => void;
}) {
  const [page, setPage] = useState<ManualTestResultPage | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, ManualTestResultDraft>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    try {
      const loaded = await getManualTestResultPage(groupId);
      const selected = loaded.batches[0];
      setPage(loaded);
      setBatchId(selected?.id ?? null);
      setDrafts(draftsFor(loaded, selected));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "人工结果加载失败");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, [groupId]);

  const selectBatch = (nextId: number) => {
    const batch = page?.batches.find((item) => item.id === nextId);
    if (!page || !batch) return;
    setBatchId(nextId);
    setDrafts(draftsFor(page, batch));
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

  const applyBatch = (saved: ManualTestResultBatch) => {
    if (!page) return;
    const nextPage = {
      ...page,
      batches: [saved, ...page.batches.filter((item) => item.id !== saved.id)],
    };
    setPage(nextPage);
    setBatchId(saved.id);
    setDrafts(draftsFor(nextPage, saved));
  };

  const save = async (caseIds: number[]) => {
    setBusy(true);
    setMessage(null);
    try {
      const commands = await Promise.all(caseIds.map(commandFor));
      const saved =
        batchId === null
          ? await createManualTestResultBatch(groupId, commands)
          : await saveManualTestResultBatch(batchId, commands);
      applyBatch(saved);
      setMessage(caseIds.length === 1 ? "当前行已保存。" : "当前批次已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "人工结果保存失败");
    } finally {
      setBusy(false);
    }
  };

  const removeResult = async (resultId: number) => {
    setBusy(true);
    try {
      await deleteManualTestResult(resultId);
      await load();
      setMessage("人工结果已删除；相关报告将在生成后标记为过期。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "人工结果删除失败");
    } finally {
      setBusy(false);
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    setBusy(true);
    try {
      await deleteManualTestAttachment(attachmentId);
      await load();
      setMessage("附件已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "附件删除失败");
    } finally {
      setBusy(false);
    }
  };

  const currentBatch = page?.batches.find((item) => item.id === batchId);
  return (
    <section
      className="manual-test-results-panel"
      aria-labelledby="manual-test-results-title"
    >
      <div className="test-group-heading">
        <div>
          <h3 id="manual-test-results-title">人工测试结果</h3>
          <p>
            仅显示当前测试组的人工和混合用例；可逐行或按批次保存，并在下次打开时继续编辑。
          </p>
        </div>
        <button type="button" onClick={onBack}>
          返回测试组
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {!page && !message && <p role="status">正在加载人工测试结果…</p>}
      {page && (
        <>
          {page.batches.length > 0 && (
            <div className="workspace-actions">
              <label className="manual-test-batch-picker">
                记录批次
                <select
                  value={batchId ?? ""}
                  onChange={(event) => selectBatch(Number(event.target.value))}
                >
                  {batchId === null && (
                    <option value="">新记录批次（未保存）</option>
                  )}
                  {page.batches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      批次 #{batch.batch_number}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBatchId(null);
                  setDrafts(draftsFor(page, undefined));
                  setMessage("已新建未保存的记录批次。");
                }}
              >
                新建记录批次
              </button>
            </div>
          )}
          {page.cases.length === 0 ? (
            <p>当前测试组没有人工或混合用例。</p>
          ) : (
            <div className="manual-test-result-list">
              {page.cases.map((item) => (
                <ManualTestResultRow
                  key={item.id}
                  item={item}
                  draft={drafts[item.id]}
                  saved={currentBatch?.results.find(
                    (result) => result.source_test_case_id === item.id,
                  )}
                  busy={busy}
                  onDraftChange={(change) =>
                    setDrafts((current) => ({
                      ...current,
                      [item.id]: { ...current[item.id], ...change },
                    }))
                  }
                  onSave={() => void save([item.id])}
                  onDeleteResult={(resultId) => void removeResult(resultId)}
                  onDeleteAttachment={(attachmentId) =>
                    void removeAttachment(attachmentId)
                  }
                />
              ))}
            </div>
          )}
          {page.cases.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(page.cases.map((item) => item.id))}
            >
              保存当前批次
            </button>
          )}
        </>
      )}
    </section>
  );
}
