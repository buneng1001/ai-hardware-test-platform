import { V020ConfirmDialog } from "./V020ConfirmDialog";
import type {
  ImportDeletionImpact,
  SourceTestCaseImportRecord,
} from "./sourceTestCasesApi";

type SourceTestCaseImportRecordsProps = {
  records: SourceTestCaseImportRecord[];
  deletionImpact: ImportDeletionImpact | null;
  onPreviewDeletion: (recordId: number) => void;
  onCancelDeletion: () => void;
  onConfirmDeletion: () => void;
};

export function SourceTestCaseImportRecords({
  records,
  deletionImpact,
  onPreviewDeletion,
  onCancelDeletion,
  onConfirmDeletion,
}: SourceTestCaseImportRecordsProps) {
  return (
    <>
      {records.length > 0 && (
        <section className="source-case-records" aria-label="导入记录">
          <h4>导入记录</h4>
          {records.map((record) => (
            <div key={record.id}>
              <span>{record.source_filename}</span>
              <button
                type="button"
                onClick={() => onPreviewDeletion(record.id)}
              >
                删除导入记录
              </button>
            </div>
          ))}
        </section>
      )}
      {deletionImpact && (
        <V020ConfirmDialog
          ariaLabel="删除导入记录影响"
          confirmLabel="确认删除导入记录"
          onCancel={onCancelDeletion}
          onConfirm={onConfirmDeletion}
          title="删除导入记录"
        >
          <p className="prototype-muted">{deletionImpact.message}</p>
          <p>
            原始用例：{deletionImpact.source_test_cases}；自动化用例：
            {deletionImpact.automation_test_cases}
          </p>
        </V020ConfirmDialog>
      )}
    </>
  );
}
