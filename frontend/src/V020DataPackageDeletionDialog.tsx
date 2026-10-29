import type { DataPackageDeletionImpact } from "./dataPackagesApi";

/** 冻结版删除确认：先展示关联测试组、用例和执行记录的影响范围。 */
export function V020DataPackageDeletionDialog({
  impact,
  busy,
  onCancel,
  onConfirm,
}: {
  impact: DataPackageDeletionImpact;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section
      className="prototype-card prototype-data-dialog"
      role="dialog"
      aria-label="删除数据包影响范围"
    >
      <h3>删除 {impact.package_number}</h3>
      <p className="prototype-muted">
        删除只移除数据包登记，不会删除来源任务或 v0.1.0 运行记录。
      </p>
      <ul>
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
      <div className="prototype-actions">
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
        <button
          className="prototype-primary"
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          确认删除数据包
        </button>
      </div>
    </section>
  );
}
