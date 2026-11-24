import { TestSteps } from "./V020PrototypeShared";
import {
  sourceAutomationRelations,
  type SourceTestCase,
} from "./sourceTestCasesApi";

function validationLabel(status: string) {
  if (status === "passed") return "已校验";
  if (status === "failed") return "校验失败";
  if (status === "unvalidated") return "未校验";
  return "校验状态未知";
}

function stepsOf(item: SourceTestCase): string[] {
  return item.steps
    .split(/\r?\n/)
    .map((step) => step.trim())
    .filter(Boolean);
}

/** 冻结版原始用例表：展示导入的 12 个字段，未填写字段显示占位而不是伪造值。 */
export function V020SourceCaseTable({
  items,
  selectedIds,
  busy,
  hasCases,
  focusCaseId,
  onToggle,
  relationStatus,
  onRetryRelations,
  onOpenAutomation,
}: {
  items: SourceTestCase[];
  selectedIds: number[];
  busy: boolean;
  hasCases: boolean;
  focusCaseId: number | null;
  onToggle: (itemId: number) => void;
  relationStatus: "idle" | "loading" | "ready" | "error";
  onRetryRelations: () => void;
  onOpenAutomation: (caseId: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="prototype-card">
        <h3>
          {hasCases ? "当前筛选没有匹配的原始用例" : "还没有原始测试用例"}
        </h3>
        <p className="prototype-muted">
          {hasCases
            ? "模块、测试类型等筛选是“同时满足”的关系；清空其中一个筛选条件再试。"
            : "导入 Beta 产品需求或测试用例资料后，会形成独立导入记录和原始用例表。"}
        </p>
      </div>
    );
  }

  return (
    <div className="prototype-table-wrap">
      <table className="prototype-table prototype-case-table prototype-source-table">
        <thead>
          <tr>
            <th className="is-narrow">选择</th>
            <th className="is-narrow">用例编号</th>
            <th className="is-title">标题</th>
            <th className="is-narrow">类型</th>
            <th className="is-long-text">预置条件</th>
            <th className="is-long-text">输入</th>
            <th className="is-steps">操作步骤</th>
            <th className="is-long-text">预期结果</th>
            <th className="is-narrow">模块</th>
            <th className="is-narrow">测试类型</th>
            <th className="is-narrow">优先级</th>
            <th className="is-narrow">软件版本</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const checked = selectedIds.includes(item.id);
            const relations =
              relationStatus === "ready"
                ? sourceAutomationRelations(item)
                : null;
            return (
              <tr
                className={
                  focusCaseId === item.id
                    ? "prototype-row-highlight"
                    : undefined
                }
                id={`source-test-case-${item.id}`}
                tabIndex={-1}
                key={item.id}
              >
                <td>
                  <input
                    aria-label={`选择用例 ${item.case_number}`}
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => onToggle(item.id)}
                  />
                </td>
                <td>
                  {item.case_number}
                  {item.source_import_status === "import_deleted" && (
                    <em className="prototype-source-deleted">导入记录已删除</em>
                  )}
                </td>
                <td className="is-title">{item.title}</td>
                <td className="is-narrow">
                  {/* 原始用例永远是人工执行；已生成自动化版本只是附注，不代表这条会变成自动化。 */}
                  <span className="prototype-type-badge prototype-type-manual">
                    人工
                  </span>
                  {relationStatus === "loading" || relationStatus === "idle" ? (
                    <small className="prototype-badge-hint" role="status">
                      关联信息加载中…
                    </small>
                  ) : relations === null ? (
                    <div className="prototype-source-relations">
                      <small role="alert">关联信息加载失败，请重试</small>
                      <button
                        type="button"
                        className="prototype-secondary"
                        onClick={onRetryRelations}
                      >
                        重试关联
                      </button>
                    </div>
                  ) : relations.length > 0 ? (
                    <details className="prototype-source-relations">
                      <summary>自动化 ×{relations.length}</summary>
                      <ul aria-label={`${item.case_number} 关联自动化用例`}>
                        {relations.map((relation) => (
                          <li key={relation.id}>
                            <button
                              type="button"
                              className="prototype-secondary"
                              onClick={() => onOpenAutomation(relation.id)}
                            >
                              {relation.case_number || `#${relation.id}`} ·{" "}
                              {relation.title || "未填写标题"}
                            </button>
                            <small>
                              {validationLabel(relation.validation_status)}
                            </small>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </td>
                <td className="is-long-text">
                  {item.preconditions || "未填写"}
                </td>
                <td className="is-long-text">{item.input || "未填写"}</td>
                <td className="is-steps">
                  {stepsOf(item).length > 0 ? (
                    <TestSteps steps={stepsOf(item)} />
                  ) : (
                    <span className="prototype-muted">未填写</span>
                  )}
                </td>
                <td className="is-long-text">
                  {item.expected_result || "未填写"}
                </td>
                <td className="is-narrow">{item.module || "未分类"}</td>
                <td className="is-narrow">{item.test_type || "未填写"}</td>
                <td className="is-narrow">{item.priority || "未填写"}</td>
                <td className="is-narrow">
                  {item.software_version || "未填写"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
