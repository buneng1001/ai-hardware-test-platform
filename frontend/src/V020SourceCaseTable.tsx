import { TestSteps } from "./V020PrototypeShared";
import type { SourceTestCase } from "./sourceTestCasesApi";

function stepsOf(item: SourceTestCase): string[] {
  return item.steps
    .split(/\r?\n/)
    .map((step) => step.trim())
    .filter(Boolean);
}

/** 冻结版原始用例表：真实字段直接展示，未填写字段显示占位而不是伪造值。 */
export function V020SourceCaseTable({
  items,
  selectedIds,
  busy,
  hasCases,
  onToggle,
}: {
  items: SourceTestCase[];
  selectedIds: number[];
  busy: boolean;
  hasCases: boolean;
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
      <table className="prototype-table prototype-case-table">
        <thead>
          <tr>
            <th>选择</th>
            <th>用例编号</th>
            <th>标题</th>
            <th>模块</th>
            <th>测试步骤</th>
            <th>优先级</th>
            <th>测试项</th>
            <th>软件版本</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const checked = selectedIds.includes(item.id);
            return (
              <tr key={item.id}>
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
                <td>{item.title}</td>
                <td>{item.module || "未分类"}</td>
                <td>
                  {stepsOf(item).length > 0 ? (
                    <TestSteps steps={stepsOf(item)} />
                  ) : (
                    <span className="prototype-muted">未填写</span>
                  )}
                </td>
                <td>{item.priority || "未填写"}</td>
                <td>{item.test_item || "未填写"}</td>
                <td>{item.software_version || "未填写"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
