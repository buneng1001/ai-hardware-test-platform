import { V020ExecutionRecordCard } from "./V020ExecutionRecordCard";
import { useV020AutomationExecution } from "./useV020AutomationExecution";

/** 冻结版“执行与结果”自动化卡片：只读最新记录和刷新入口。 */
export function V020ExecutionResultCard({ groupId }: { groupId: number }) {
  const execution = useV020AutomationExecution(groupId);
  const latest = execution.records[0] ?? null;

  return (
    <div className="prototype-result-card">
      <strong>自动化执行结果</strong>
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
        (latest ? (
          <V020ExecutionRecordCard record={latest} showCases={false} />
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
