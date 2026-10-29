import { V020AutomationCaseRow } from "./V020AutomationCaseRow";
import type {
  AutomationTestCase,
  AutomationTestCaseDraft,
} from "./automationTestCasesApi";

/** 冻结版自动化用例表：真实字段、行内编辑、反馈和历史。 */
export function V020AutomationCaseTable({
  items,
  productVersionId,
  busy,
  onOpenSource,
  onSave,
  onFeedback,
  onRegenerate,
  onDelete,
  onDirtyChange,
  onRegisterSubmit,
}: {
  items: AutomationTestCase[];
  productVersionId: number;
  busy: boolean;
  onOpenSource: (sourceTestCaseId: number) => void;
  onSave: (caseId: number, draft: AutomationTestCaseDraft) => Promise<boolean>;
  onFeedback: (caseId: number, feedback: string) => Promise<boolean>;
  onRegenerate: (caseId: number) => Promise<boolean>;
  onDelete: (caseId: number) => Promise<boolean>;
  onDirtyChange: (caseId: number, dirty: boolean) => void;
  onRegisterSubmit: (
    caseId: number,
    submit: (() => Promise<boolean>) | null,
  ) => void;
}) {
  return (
    <div className="prototype-table-wrap">
      <table className="prototype-table prototype-case-table">
        <thead>
          <tr>
            <th>用例编号</th>
            <th>标题</th>
            <th>来源用例</th>
            <th>输入</th>
            <th>操作步骤</th>
            <th>预期结果</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <V020AutomationCaseRow
              busy={busy}
              item={item}
              key={item.id}
              productVersionId={productVersionId}
              onDelete={onDelete}
              onDirtyChange={onDirtyChange}
              onFeedback={onFeedback}
              onOpenSource={onOpenSource}
              onRegisterSubmit={onRegisterSubmit}
              onRegenerate={onRegenerate}
              onSave={onSave}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
