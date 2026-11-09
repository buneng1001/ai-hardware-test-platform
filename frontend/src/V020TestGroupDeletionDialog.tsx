import { V020ConfirmDialog } from "./V020ConfirmDialog";
import type { TestGroupDeletionImpact } from "./testGroupsApi";

/** 删除测试组确认弹窗：先展示测试组范围、关联和人工结果影响。 */
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
    <V020ConfirmDialog
      ariaLabel="删除测试组影响范围"
      busy={busy}
      confirmLabel="确认删除测试组"
      onCancel={onCancel}
      onConfirm={onConfirm}
      title={`删除测试组 ${impact.name}`}
    >
      <p className="prototype-muted">{impact.message}</p>
      <ul>
        <li>人工用例：{impact.source_test_cases}</li>
        <li>自动化用例：{impact.automation_test_cases}</li>
        <li>数据包关联：{impact.data_package_assignments}</li>
        <li>人工结果批次：{impact.manual_test_result_batches}</li>
        <li>人工结果：{impact.manual_test_results}</li>
        <li>人工结果附件：{impact.manual_test_result_attachments}</li>
      </ul>
    </V020ConfirmDialog>
  );
}
