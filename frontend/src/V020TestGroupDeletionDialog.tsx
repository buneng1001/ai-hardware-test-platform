import type { TestGroupDeletionImpact } from "./testGroupsApi";

/** 冻结版删除确认：先展示测试组范围、关联和人工结果影响。 */
export function V020TestGroupDeletionDialog({
  impact,
  busy,
  onCancel,
  onConfirm,
}: {
  impact: TestGroupDeletionImpact;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section
      className="prototype-card prototype-group-dialog"
      role="dialog"
      aria-label="删除测试组影响范围"
    >
      <h3>删除测试组 {impact.name}</h3>
      <p className="prototype-muted">{impact.message}</p>
      <ul>
        <li>原始用例：{impact.source_test_cases}</li>
        <li>自动化用例：{impact.automation_test_cases}</li>
        <li>数据包关联：{impact.data_package_assignments}</li>
        <li>人工结果批次：{impact.manual_test_result_batches}</li>
        <li>人工结果：{impact.manual_test_results}</li>
        <li>人工结果附件：{impact.manual_test_result_attachments}</li>
      </ul>
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
          确认删除测试组
        </button>
      </div>
    </section>
  );
}
