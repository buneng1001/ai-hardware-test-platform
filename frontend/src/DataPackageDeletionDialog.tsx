import type { DataPackageDeletionImpact } from "./dataPackagesApi";

type Props = {
  impact: DataPackageDeletionImpact;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DataPackageDeletionDialog({
  impact,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <div className="workspace-dialog-backdrop">
      <section
        className="workspace-dialog"
        role="dialog"
        aria-label="删除数据包影响范围"
      >
        <h3>删除 {impact.package_number}</h3>
        <p>删除只移除数据包登记，不会删除来源任务或 v0.1.0 运行记录。</p>
        <ul className="impact-list">
          <li>测试组：{impact.association_counts.test_groups ?? 0}</li>
          <li>
            自动化用例：{impact.association_counts.automation_test_cases ?? 0}
          </li>
          <li>
            自动化执行记录：
            {impact.association_counts.automation_execution_records ?? 0}
          </li>
        </ul>
        <p>关联合计：{impact.total_associations}</p>
        <div className="workspace-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            确认删除数据包
          </button>
        </div>
      </section>
    </div>
  );
}
