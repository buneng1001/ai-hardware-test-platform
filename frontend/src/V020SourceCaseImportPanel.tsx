import { importOptionFields } from "./SourceTestCaseImportForm";
import {
  sourceCaseFields,
  type ImportOptions,
  type SourceTestCaseImportDraft,
} from "./sourceTestCasesApi";

const importOptionsOrDefault = (
  draft: SourceTestCaseImportDraft,
): ImportOptions => ({
  include_historical_results: false,
  include_test_records: false,
  include_pre_test_notes: false,
  include_planned_execution_time: false,
  include_attachments: false,
  ...draft.import_options,
});

/** 冻结版字段映射确认区：只确认映射和导入范围，不创建需求点或用例。 */
export function V020SourceCaseImportPanel({
  draft,
  busy,
  onDraftChange,
  onConfirm,
  onCancel,
}: {
  draft: SourceTestCaseImportDraft;
  busy: boolean;
  onDraftChange: (draft: SourceTestCaseImportDraft) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const options = importOptionsOrDefault(draft);
  const columns = Object.keys(draft.rows[0] ?? {});

  return (
    <section className="prototype-field-mapping" aria-label="确认字段映射">
      <div>
        <h3>确认字段映射</h3>
        <p className="prototype-muted">
          文件：{draft.source_filename} · {draft.rows.length}{" "}
          行。“输入”和其他可选字段可以留空或选择不导入。
        </p>
      </div>
      <div className="prototype-field-mapping-grid">
        {sourceCaseFields.map(([field, label]) => (
          <label key={field}>
            {label}
            <select
              aria-label={`${label}映射`}
              value={draft.field_mapping[field] ?? ""}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  field_mapping: {
                    ...draft.field_mapping,
                    [field]: event.target.value,
                  },
                })
              }
            >
              <option value="">不导入</option>
              {columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <fieldset className="prototype-import-options">
        <legend>导入范围</legend>
        {importOptionFields.map(([field, label]) => (
          <label key={field}>
            <input
              aria-label={label}
              type="checkbox"
              checked={options[field]}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  import_options: {
                    ...options,
                    [field]: event.target.checked,
                  },
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="prototype-actions">
        <button
          className="prototype-primary"
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          确认并导入
        </button>
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </section>
  );
}
