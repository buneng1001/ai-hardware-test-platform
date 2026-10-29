import { V020AutomationCaseTable } from "./V020AutomationCaseTable";
import { useV020AutomationTestCases } from "./useV020AutomationTestCases";
import "./V020AutomationCases.css";

/**
 * 冻结版“自动化用例表”页：读取当前产品版本的真实规则候选，
 * 补齐生成、加载、空、失败和重试状态。
 */
export function V020AutomationCasesScreen({
  versionId,
  onOpenGroups,
  onOpenSource,
}: {
  versionId: number | null;
  onOpenGroups: () => void;
  onOpenSource: (sourceTestCaseId: number) => void;
}) {
  const automation = useV020AutomationTestCases(versionId);

  if (versionId === null) {
    return (
      <div className="prototype-inline-note">
        请先在“版本与趋势”中打开一个产品版本，再生成自动化用例候选。
      </div>
    );
  }

  if (automation.status === "loading" || automation.status === "idle") {
    return (
      <p className="prototype-muted" role="status">
        正在加载自动化用例…
      </p>
    );
  }

  if (automation.status === "error") {
    return (
      <div className="prototype-inline-note" role="alert">
        自动化用例加载失败：{automation.error}
        <button
          className="prototype-secondary"
          onClick={automation.retry}
          type="button"
        >
          重试
        </button>
      </div>
    );
  }

  const failedCount = automation.items.filter(
    (item) => item.conversion_status === "failed",
  ).length;

  return (
    <>
      <div className="prototype-case-toolbar prototype-automation-toolbar">
        <p className="prototype-muted">
          规则转换不依赖 AI；共 {automation.items.length} 条候选，其中转换失败
          {failedCount} 条，全部需要人工审核。
        </p>
        <div className="prototype-actions">
          <button
            disabled={automation.busy}
            onClick={() => void automation.convert()}
            type="button"
          >
            生成自动化用例
          </button>
          <button
            className="prototype-secondary"
            disabled={automation.busy}
            onClick={automation.retry}
            type="button"
          >
            刷新
          </button>
          <button
            className="prototype-secondary"
            onClick={onOpenGroups}
            type="button"
          >
            加入测试组
          </button>
        </div>
      </div>

      {automation.actionError && (
        <div className="prototype-inline-note" role="alert">
          {automation.actionError}
        </div>
      )}
      {automation.message && (
        <p className="prototype-muted" role="status">
          {automation.message}
        </p>
      )}

      {automation.items.length === 0 ? (
        <div className="prototype-card">
          <h3>还没有自动化用例候选</h3>
          <p className="prototype-muted">
            先导入原始测试用例，再点击“生成自动化用例”。规则转换可离线运行，不需要模型或
            Skill。
          </p>
        </div>
      ) : (
        <V020AutomationCaseTable
          items={automation.items}
          onOpenSource={onOpenSource}
        />
      )}

      <div className="prototype-inline-note">
        自动化用例与原始用例分开保存；生成候选不会修改或覆盖原始内容。
      </div>
    </>
  );
}
