import { Status } from "./V020PrototypeShared";
import type { AutomationExecution } from "./automationExecutionsApi";

const statusLabels: Record<string, string> = {
  completed: "已完成",
  cancelled: "已取消",
  interrupted: "已中断",
  failed: "失败",
  running: "执行中",
};

const resultLabels: Record<string, string> = {
  passed: "通过",
  failed: "失败",
  blocked: "阻塞",
  not_executed: "未执行",
};

export function formatExecutionTime(value: string | null): string {
  return value ? value.slice(0, 16).replace("T", " ") : "未记录";
}

/** 冻结版自动化执行卡片：编号、时间、状态、结果统计和用例结果。 */
export function V020ExecutionRecordCard({
  record,
  showCases = true,
}: {
  record: AutomationExecution;
  showCases?: boolean;
}) {
  return (
    <article
      className="prototype-result-card prototype-execution-record"
      aria-label={`自动化执行 ${record.execution_number}`}
    >
      <header className="prototype-execution-record-head">
        <strong>自动化执行 #{record.execution_number}</strong>
        <Status tone={record.status === "completed" ? "good" : "warn"}>
          {statusLabels[record.status] ?? record.status}
        </Status>
      </header>
      <p>
        执行时间：{formatExecutionTime(record.started_at)} · 完成时间：
        {formatExecutionTime(record.completed_at)}
      </p>
      <p>执行模式：数据驱动模拟（不连接真实设备）</p>
      <p>
        通过 {record.summary.passed} · 失败 {record.summary.failed} · 阻塞{" "}
        {record.summary.blocked} · 未执行 {record.summary.not_executed}
      </p>
      {showCases && record.case_results.length > 0 && (
        <ul className="prototype-execution-cases">
          {record.case_results.map((result) => (
            <li key={result.automation_test_case_id}>
              <Status tone={result.status === "passed" ? "good" : "warn"}>
                {resultLabels[result.status] ?? result.status}
              </Status>
              <span>
                {result.case_number} · {result.title}
              </span>
              <small>{result.message}</small>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
