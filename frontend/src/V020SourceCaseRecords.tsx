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
          : "重新导入同一份用例表时勾选“覆盖已有用例”，就不会把同一批用例堆成两份。"}
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
        <div className="prototype-modal-backdrop">
          <div
            aria-label="删除导入记录影响"
            aria-modal="true"
            className="prototype-modal"
            role="dialog"
          >
            <h3>删除导入记录</h3>
            <p>{deletionImpact.message}</p>
            <p>
              将清除原始用例 <strong>{deletionImpact.source_test_cases}</strong>{" "}
              条，关联自动化用例{" "}
              <strong>{deletionImpact.automation_test_cases}</strong>{" "}
              条，删除后不可恢复。
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
                className="prototype-danger"
                disabled={busy}
                onClick={onConfirmDeletion}
                type="button"
              >
                确认删除导入记录及用例
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
