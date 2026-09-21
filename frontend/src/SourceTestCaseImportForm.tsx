import {
  sourceCaseFields,
  type ImportOptions,
  type SourceTestCaseImportDraft,
} from "./sourceTestCasesApi";

const defaultOptions: ImportOptions = {
  include_historical_results: false,
  include_test_records: false,
  include_pre_test_notes: false,
  include_planned_execution_time: false,
  include_attachments: false,
};

type SourceTestCaseImportFormProps = {
  draft: SourceTestCaseImportDraft | null;
  onPreview: (file: File | undefined) => void;
  onDraftChange: (draft: SourceTestCaseImportDraft) => void;
  onConfirm: () => void;
};

export function SourceTestCaseImportForm({
  draft,
  onPreview,
  onDraftChange,
  onConfirm,
}: SourceTestCaseImportFormProps) {
  return (
    <>
      <label className="source-case-file">
        选择 Beta 测试用例文件
        <input
          aria-label="选择 Beta 测试用例文件"
          type="file"
          accept=".csv,.xlsx"
          onChange={(event) => onPreview(event.target.files?.[0])}
        />
      </label>
      {draft && (
        <FieldMappingConfirmation
          draft={draft}
          onDraftChange={onDraftChange}
          onConfirm={onConfirm}
        />
      )}
    </>
  );
}

function FieldMappingConfirmation({
  draft,
  onDraftChange,
  onConfirm,
}: Omit<SourceTestCaseImportFormProps, "draft" | "onPreview"> & {
  draft: SourceTestCaseImportDraft;
}) {
  const options = { ...defaultOptions, ...draft.import_options };
  return (
    <section className="source-case-mapping" aria-label="确认字段映射">
      <h4>确认字段映射</h4>
      <p>“输入”可以不映射；其余可选字段也可以留空。</p>
      <div className="source-case-mapping-grid">
        {sourceCaseFields.map(([field, label]) => (
          <label key={field}>
            {label}映射
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
              {Object.keys(draft.rows[0] ?? {}).map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <fieldset>
        <legend>导入目的</legend>
        {importOptionFields.map(([field, label]) => (
          <label key={field}>
            <input
              type="checkbox"
              checked={options[field]}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  import_options: { ...options, [field]: event.target.checked },
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <button type="button" onClick={onConfirm}>
        确认并导入
      </button>
    </section>
  );
}

const importOptionFields: Array<[keyof ImportOptions, string]> = [
  ["include_historical_results", "导入历史测试结果"],
  ["include_test_records", "导入测试记录"],
  ["include_pre_test_notes", "导入测试前备注"],
  ["include_planned_execution_time", "导入计划执行时间"],
  ["include_attachments", "导入附件"],
];

export { defaultOptions as defaultSourceTestCaseImportOptions };
