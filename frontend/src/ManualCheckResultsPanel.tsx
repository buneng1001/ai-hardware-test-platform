import { useState } from "react";

import { ManualCheckResultList } from "./ManualCheckResultList";
import {
  type ManualCheckResult,
  type ManualCheckStatus,
  createManualCheckResult,
  importManualCheckResults,
  manualCheckStatusLabels,
  updateManualCheckResult,
} from "./manualCheckResultsApi";

type Props = {
  runId: number;
  initialResults: ManualCheckResult[];
};

export function ManualCheckResultsPanel({ runId, initialResults }: Props) {
  const [results, setResults] = useState(initialResults);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [checkStatus, setCheckStatus] = useState<ManualCheckStatus>("passed");
  const [actualResult, setActualResult] = useState("");
  const [notes, setNotes] = useState("");
  const [executedAt, setExecutedAt] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setCheckStatus("passed");
    setActualResult("");
    setNotes("");
    setExecutedAt("");
    setAttachment(null);
  };

  const readAttachment = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(String(reader.result).split(",", 2)[1] ?? "");
      reader.onerror = () => reject(new Error("附件读取失败"));
      reader.readAsDataURL(file);
    });

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("请输入检查项名称");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const command = {
        name: name.trim(),
        status: checkStatus,
        actual_result: actualResult.trim() || null,
        notes: notes.trim() || null,
        executed_at: executedAt ? new Date(executedAt).toISOString() : null,
        ...(attachment
          ? {
              attachment: {
                filename: attachment.name,
                content_type: attachment.type || "application/octet-stream",
                content_base64: await readAttachment(attachment),
              },
            }
          : {}),
      };
      const saved =
        editingId === null
          ? await createManualCheckResult(runId, command)
          : await updateManualCheckResult(runId, editingId, command);
      setResults((current) =>
        editingId === null
          ? [...current, saved]
          : current.map((result) => (result.id === editingId ? saved : result)),
      );
      resetForm();
    } catch {
      console.error("人工检查结果保存失败");
      setError("人工检查结果保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const edit = (result: ManualCheckResult) => {
    setEditingId(result.id);
    setName(result.name);
    setCheckStatus(result.status);
    setActualResult(result.actual_result ?? "");
    setNotes(result.notes ?? "");
    setExecutedAt(result.executed_at ? result.executed_at.slice(0, 16) : "");
    setAttachment(null);
    setError(null);
  };

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const imported = await importManualCheckResults(runId, file);
      setResults((current) => [...current, ...imported]);
    } catch (importError) {
      console.error("人工检查结果导入失败");
      setError(
        importError instanceof Error
          ? importError.message
          : "人工检查结果导入失败",
      );
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  return (
    <section aria-labelledby="manual-results-title">
      <h4 id="manual-results-title">人工检查结果</h4>
      <ManualCheckResultList runId={runId} results={results} onEdit={edit} />
      <label htmlFor="manual-import">导入 CSV 或 Excel</label>
      <input
        id="manual-import"
        type="file"
        accept=".csv,.xlsx"
        disabled={importing}
        onChange={(event) => void importFile(event)}
      />
      {importing && <p role="status">正在导入人工结果…</p>}
      <form onSubmit={submit}>
        <label htmlFor="manual-name">检查项名称</label>
        <input
          id="manual-name"
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <label htmlFor="manual-status">状态</label>
        <select
          id="manual-status"
          value={checkStatus}
          onChange={(event) =>
            setCheckStatus(event.target.value as ManualCheckStatus)
          }
        >
          {Object.entries(manualCheckStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="manual-actual-result">实际结果</label>
        <textarea
          id="manual-actual-result"
          maxLength={2000}
          value={actualResult}
          onChange={(event) => setActualResult(event.target.value)}
        />
        <label htmlFor="manual-executed-at">执行时间</label>
        <input
          id="manual-executed-at"
          type="datetime-local"
          value={executedAt}
          onChange={(event) => setExecutedAt(event.target.value)}
        />
        <label htmlFor="manual-attachment">
          小型附件（TXT、PNG、JPEG 或 PDF，最大 1 MiB）
        </label>
        <input
          id="manual-attachment"
          type="file"
          accept=".txt,.png,.jpg,.jpeg,.pdf"
          onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
        />
        <label htmlFor="manual-notes">备注</label>
        <textarea
          id="manual-notes"
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={saving}>
          {saving
            ? "正在保存…"
            : editingId === null
              ? "保存人工结果"
              : "更新人工结果"}
        </button>
      </form>
    </section>
  );
}
