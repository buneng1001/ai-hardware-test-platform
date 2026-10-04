import {
  manualTestStatusLabels,
  type ManualTestResult,
  type ManualTestResultPage,
  type ManualTestStatus,
} from "./manualTestResultsApi";
import type { ManualTestResultDraft } from "./manualTestResultDrafts";

type Props = {
  item: ManualTestResultPage["cases"][number];
  draft: ManualTestResultDraft;
  saved?: ManualTestResult;
  busy: boolean;
  onDraftChange: (change: Partial<ManualTestResultDraft>) => void;
  onSave: () => void;
  onDeleteResult: (resultId: number) => void;
  onDeleteAttachment: (attachmentId: number) => void;
};

export function ManualTestResultRow({
  item,
  draft,
  saved,
  busy,
  onDraftChange,
  onSave,
  onDeleteResult,
  onDeleteAttachment,
}: Props) {
  return (
    <article className="manual-test-result-row">
      <strong>
        {item.case_number} · {item.title}
      </strong>
      <label>
        状态
        <select
          aria-label={`${item.case_number} 状态`}
          value={draft.status}
          onChange={(event) =>
            onDraftChange({ status: event.target.value as ManualTestStatus })
          }
        >
          {Object.entries(manualTestStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        实际结果
        <textarea
          aria-label={`${item.case_number} 实际结果`}
          value={draft.actualResult}
          onChange={(event) =>
            onDraftChange({ actualResult: event.target.value })
          }
        />
      </label>
      <label>
        备注
        <textarea
          value={draft.notes}
          onChange={(event) => onDraftChange({ notes: event.target.value })}
        />
      </label>
      <label>
        执行时间
        <input
          type="datetime-local"
          value={draft.executedAt}
          onChange={(event) =>
            onDraftChange({ executedAt: event.target.value })
          }
        />
      </label>
      <label>
        附件
        <input
          type="file"
          accept=".txt,.png,.jpg,.jpeg,.pdf"
          onChange={(event) =>
            onDraftChange({ attachment: event.target.files?.[0] ?? null })
          }
        />
      </label>
      {saved && (
        <div className="manual-test-attachments">
          {saved.attachments.map((attachment) => (
            <span key={attachment.id}>
              <a
                href={`/api/manual-test-attachments/${attachment.id}/download`}
              >
                {attachment.filename}（{attachment.size_bytes} 字节，
                {attachment.storage_status === "stored" ? "已存储" : "已清理"}）
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDeleteAttachment(attachment.id)}
              >
                删除附件
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="workspace-actions">
        <button type="button" disabled={busy} onClick={onSave}>
          保存 {item.case_number}
        </button>
        {saved && (
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={() => onDeleteResult(saved.id)}
          >
            删除人工结果
          </button>
        )}
      </div>
    </article>
  );
}
