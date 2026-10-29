import { Status, TestSteps } from "./V020PrototypeShared";
import type { AutomationTestCase } from "./automationTestCasesApi";

function stepsOf(steps: string): string[] {
  return steps
    .split(/\r?\n/)
    .map((step) => step.trim())
    .filter(Boolean);
}

const emptyCell = <span className="prototype-muted">未生成</span>;

/** 冻结版自动化用例表：真实展示规则候选、来源和失败行原因。 */
export function V020AutomationCaseTable({
  items,
  onOpenSource,
}: {
  items: AutomationTestCase[];
  onOpenSource: (sourceTestCaseId: number) => void;
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
            <th>转换状态</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const failed = item.conversion_status === "failed";
            return (
              <tr
                className={failed ? "prototype-row-warning" : undefined}
                key={item.id}
              >
                <td>{item.case_number}</td>
                <td>{item.title || emptyCell}</td>
                <td>
                  <a
                    href={`#source-test-case-${item.source_test_case_id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpenSource(item.source_test_case_id);
                    }}
                  >
                    {item.source_case_number}
                  </a>
                </td>
                <td>{item.input || emptyCell}</td>
                <td>
                  {stepsOf(item.steps).length > 0 ? (
                    <TestSteps steps={stepsOf(item.steps)} />
                  ) : (
                    emptyCell
                  )}
                </td>
                <td>{item.expected_result || emptyCell}</td>
                <td>
                  <Status tone={failed ? "warn" : "good"}>
                    {failed ? "转换失败" : "规则候选"}
                  </Status>
                  <p
                    className={
                      failed
                        ? "prototype-row-note prototype-row-note--warning"
                        : "prototype-row-note"
                    }
                  >
                    {failed
                      ? item.review_note
                      : `低可信度 · ${item.review_note}`}
                  </p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
