import { useEffect } from "react";

import { V020ExecutionRecordCard } from "./V020ExecutionRecordCard";
import { useV020AutomationExecution } from "./useV020AutomationExecution";

/** “执行与结果”自动化卡片：可选报告使用的执行记录，默认最新一条。 */
export function V020ExecutionResultCard({
  groupId,
  selectedExecutionId,
  onSelectExecution,
}: {
  groupId: number;
  selectedExecutionId: number | null;
  onSelectExecution: (executionId: number | null) => void;
}) {
  const execution = useV020AutomationExecution(groupId);
  const latest = execution.records[0] ?? null;
  const selected =
    execution.records.find((item) => item.id === selectedExecutionId) ?? latest;

  useEffect(() => {
    // 默认选中最新一条，用户切换后保持不变。
    if (selectedExecutionId === null && latest) onSelectExecution(latest.id);
  }, [latest, selectedExecutionId, onSelectExecution]);

  return (
    <div className="prototype-result-card">
      <div className="prototype-result-card-head">
        <strong>自动化执行结果</strong>
        {execution.status === "ready" && execution.records.length > 0 && (
          <select
            aria-label="用于报告的自动化执行记录"
            onChange={(event) => onSelectExecution(Number(event.target.value))}
            value={selected?.id ?? ""}
          >
            {execution.records.map((item) => (
              <option key={item.id} value={item.id}>
                自动化执行 #{item.execution_number}（
                {item.status === "completed" ? "已完成" : item.status}）
              </option>
            ))}
          </select>
        )}
      </div>
      {execution.status === "loading" && (
        <p className="prototype-muted" role="status">
          正在加载自动化执行记录…
        </p>
      )}
      {execution.status === "error" && (
        <div className="prototype-inline-note" role="alert">
          自动化执行记录加载失败：{execution.error}
          <button
            className="prototype-secondary"
            onClick={execution.retry}
            type="button"
          >
            重试
          </button>
        </div>
      )}
      {execution.status === "ready" &&
        (selected ? (
          <V020ExecutionRecordCard
            record={selected}
            showCases={false}
            embedded
          />
        ) : (
          <p className="prototype-muted">
            当前测试组还没有自动化执行记录；请在测试组详情点击“执行自动化测试”。
          </p>
        ))}
      <p className="prototype-muted">
        “已完成”表示计划项都已完成尝试，不要求所有结果通过。
      </p>
      <button
        className="prototype-secondary"
        disabled={execution.status === "loading"}
        onClick={execution.refresh}
        type="button"
      >
        刷新最新结果
      </button>
    </div>
  );
}
