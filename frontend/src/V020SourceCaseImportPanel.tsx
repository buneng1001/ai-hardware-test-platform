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
  currentVersionLabel,
  onDraftChange,
  onConfirm,
  onCancel,
}: {
  draft: SourceTestCaseImportDraft;
  busy: boolean;
  currentVersionLabel: string;
  onDraftChange: (draft: SourceTestCaseImportDraft) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const options = importOptionsOrDefault(draft);
  const columns = Object.keys(draft.rows[0] ?? {});
  // 软件版本不再让用户随意挑列，改为在下面二选一。
  const mappingFields = sourceCaseFields.filter(
    ([field]) => field !== "software_version",
  );
  const versionSource = draft.software_version_source ?? "imported";
  const replaceExisting = draft.replace_existing ?? true;

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
        {mappingFields.map(([field, label]) => (
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
        <legend>软件版本</legend>
        <label>
          <input
            aria-label="保留导入的软件版本"
            checked={versionSource === "imported"}
            name="software-version-source"
            onChange={() =>
              onDraftChange({ ...draft, software_version_source: "imported" })
            }
            type="radio"
          />
          保留导入的软件版本（使用文件里的“软件版本”列）
        </label>
        <label>
          <input
            aria-label="使用当前产品版本"
            checked={versionSource === "current"}
            name="software-version-source"
            onChange={() =>
              onDraftChange({ ...draft, software_version_source: "current" })
            }
            type="radio"
          />
          使用当前产品版本
          {currentVersionLabel ? `（${currentVersionLabel}）` : ""}
        </label>
      </fieldset>
      <fieldset className="prototype-import-options">
        <legend>导入方式</legend>
        <label>
          <input
            aria-label="覆盖已有用例"
            checked={replaceExisting}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                replace_existing: event.target.checked,
              })
            }
            type="checkbox"
          />
          覆盖该版本之前导入的用例（推荐）
        </label>
      </fieldset>
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
