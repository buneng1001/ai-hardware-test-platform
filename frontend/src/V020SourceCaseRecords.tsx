import type {
  ImportDeletionImpact,
  SourceTestCaseImportRecord,
} from "./sourceTestCasesApi";

function formatImportedAt(value: string): string {
  return value ? value.slice(0, 16).replace("T", " ") : "未知时间";
}

/** 冻结版导入记录区：删除前先展示影响范围，确认后才真正删除。 */
export function V020SourceCaseRecords({
  records,
  deletionImpact,
  busy,
  onPreviewDeletion,
  onCancelDeletion,
  onConfirmDeletion,
}: {
  records: SourceTestCaseImportRecord[];
  deletionImpact: ImportDeletionImpact | null;
  busy: boolean;
  onPreviewDeletion: (importId: number) => void;
  onCancelDeletion: () => void;
  onConfirmDeletion: () => void;
}) {
  return (
    <section aria-label="导入记录">
      <div className="prototype-inline-note">
        {records.length === 0
          ? "当前产品版本还没有导入记录。"
          : "重复导入同一文件会产生新的导入记录，不会覆盖旧内容。"}
      </div>
      {records.map((record) => (
        <div className="prototype-card prototype-import-record" key={record.id}>
          <div>
            <strong>{record.source_filename}</strong>
            <p className="prototype-muted">
              导入时间：{formatImportedAt(record.imported_at)} · 记录编号：
              {record.id}
            </p>
          </div>
          <button
            className="prototype-secondary"
            disabled={busy}
            onClick={() => onPreviewDeletion(record.id)}
            type="button"
          >
            删除导入记录
          </button>
        </div>
      ))}
      {deletionImpact && (
        <div
          aria-label="删除导入记录影响"
          className="prototype-card prototype-deletion-impact"
          role="dialog"
        >
          <h3>删除导入记录前确认影响</h3>
          <p>{deletionImpact.message}</p>
          <p>
            原始用例：{deletionImpact.source_test_cases} 条；关联自动化用例：
            {deletionImpact.automation_test_cases} 条
          </p>
          <div className="prototype-actions">
            <button
              className="prototype-secondary"
              disabled={busy}
              onClick={onCancelDeletion}
              type="button"
            >
              取消
            </button>
            <button
              className="prototype-primary"
              disabled={busy}
              onClick={onConfirmDeletion}
              type="button"
            >
              确认删除导入记录
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
