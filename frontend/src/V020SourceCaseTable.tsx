import { TestSteps } from "./V020PrototypeShared";
import type { SourceTestCase } from "./sourceTestCasesApi";

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
}: {
  items: SourceTestCase[];
  selectedIds: number[];
  busy: boolean;
  hasCases: boolean;
  focusCaseId: number | null;
  onToggle: (itemId: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="prototype-card">
        <h3>
          {hasCases ? "当前筛选没有匹配的原始用例" : "还没有原始测试用例"}
        </h3>
        <p className="prototype-muted">
          {hasCases
            ? "调整模块、测试项、优先级或软件版本筛选后再查看。"
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
            return (
              <tr
                className={
                  focusCaseId === item.id
                    ? "prototype-row-highlight"
                    : undefined
                }
                id={`source-test-case-${item.id}`}
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
                  {item.case_type === "automation" && (
                    <small className="prototype-badge-hint">
                      {item.automation_validation_status === "passed"
                        ? "已生成自动化"
                        : "自动化待校验"}
                    </small>
                  )}
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
