import {
  manualTestStatusLabels,
  type ManualTestResult,
  type ManualTestResultPage,
  type ManualTestStatus,
} from "./manualTestResultsApi";
import type { ManualTestResultDraft } from "./manualTestResultDrafts";

/** 冻结版人工结果行：状态、实际结果、备注、执行时间、附件和保存/删除。 */
export function V020ManualResultRow({
  item,
  draft,
  saved,
  busy,
  onDraftChange,
  onSave,
  onDeleteResult,
  onDeleteAttachment,
}: {
  item: ManualTestResultPage["cases"][number];
  draft: ManualTestResultDraft;
  saved?: ManualTestResult;
  busy: boolean;
  onDraftChange: (change: Partial<ManualTestResultDraft>) => void;
  onSave: () => void;
  onDeleteResult: (resultId: number) => void;
  onDeleteAttachment: (attachmentId: number) => void;
}) {
  return (
    <tr>
      <td>{item.case_number}</td>
      <td>{item.title}</td>
      <td>{item.test_type || "未填写"}</td>
      <td>
        <select
          aria-label={`${item.case_number} 测试结果`}
          disabled={busy}
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
      </td>
      <td>
        <textarea
          aria-label={`${item.case_number} 实际结果`}
          disabled={busy}
          rows={2}
          value={draft.actualResult}
          onChange={(event) =>
            onDraftChange({ actualResult: event.target.value })
          }
        />
      </td>
      <td>
        <textarea
          aria-label={`${item.case_number} 备注`}
          disabled={busy}
          rows={2}
          value={draft.notes}
          onChange={(event) => onDraftChange({ notes: event.target.value })}
        />
      </td>
      <td>
        <input
          aria-label={`${item.case_number} 执行时间`}
          disabled={busy}
          type="datetime-local"
          value={draft.executedAt}
          onChange={(event) =>
            onDraftChange({ executedAt: event.target.value })
          }
        />
      </td>
      <td>
        <input
          aria-label={`${item.case_number} 附件`}
          accept=".txt,.png,.jpg,.jpeg,.pdf"
          disabled={busy}
          type="file"
          onChange={(event) =>
            onDraftChange({ attachment: event.target.files?.[0] ?? null })
          }
        />
        {saved?.attachments.map((attachment) => (
          <div className="prototype-manual-attachment" key={attachment.id}>
            <a href={`/api/manual-test-attachments/${attachment.id}/download`}>
              {attachment.filename}
            </a>
            <span>
              {attachment.size_bytes} 字节 ·{" "}
              {attachment.storage_status === "stored" ? "已存储" : "已清理"} ·{" "}
              {attachment.usage_status === "used" ? "已使用" : "未使用"}
            </span>
            <button
              className="prototype-secondary"
              disabled={busy}
              onClick={() => onDeleteAttachment(attachment.id)}
              type="button"
            >
              删除附件
            </button>
          </div>
        ))}
        <div className="prototype-actions">
          <button
            className="prototype-secondary"
            disabled={busy}
            onClick={onSave}
            type="button"
          >
            保存 {item.case_number}
          </button>
          {saved && (
            <button
              className="prototype-secondary"
              disabled={busy}
              onClick={() => onDeleteResult(saved.id)}
              type="button"
            >
              删除人工结果
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
