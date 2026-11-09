import { V020ExecutionRecordCard } from "./V020ExecutionRecordCard";
import type { PreparationCheck } from "./automationExecutionsApi";
import type { V020AutomationExecution } from "./useV020AutomationExecution";
import "./V020AutomationExecutions.css";

const actionLabels: Record<PreparationCheck["action"], string> = {
  edit_group: "编辑测试组",
  replace_data_packages: "替换数据包",
};

/**
 * 执行结果区：只展示预检结论、执行状态和可折叠的历史记录。
 * 执行入口在页面顶部，这里不再重复放按钮。
 */
export function V020AutomationExecutionPanel({
  execution,
}: {
  execution: V020AutomationExecution;
}) {
  if (execution.status === "loading" || execution.status === "idle") {
    return (
      <section
        aria-label="自动化执行与结果"
        id="test-group-automation-execution"
      >
        <h3>执行结果</h3>
        <p className="prototype-muted" role="status">
          正在加载自动化执行记录…
        </p>
      </section>
    );
  }

  if (execution.status === "error") {
    return (
      <section
        aria-label="自动化执行与结果"
        id="test-group-automation-execution"
      >
        <h3>执行结果</h3>
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
      </section>
    );
  }

  return (
    <section aria-label="自动化执行与结果" id="test-group-automation-execution">
      <h3>执行结果</h3>
      <p className="prototype-muted">
        执行模式：数据驱动模拟。只读取已校验自动化用例和数据包，不连接真实设备。
      </p>
      {execution.message && (
        <p className="prototype-muted" role="status">
          {execution.message}
        </p>
      )}
      {execution.actionError && (
        <div className="prototype-inline-note" role="alert">
          {execution.actionError}
        </div>
      )}
      {execution.checks && execution.checks.length > 0 && (
        <div className="prototype-inline-note">
          <h4>预检未通过</h4>
          <ul className="prototype-preparation-checks">
            {execution.checks.map((check) => (
              <li key={`${check.code}-${check.object_id}`}>
                <strong>{check.code}</strong>
                <span>
                  失败对象：{check.object_type} #{check.object_id}
                </span>
                <span>实际值：{check.actual}</span>
                <span>期望值：{check.expected}</span>
                <span>修复建议：{check.suggestion}</span>
                <a href="#test-group-automation-scope">
                  {actionLabels[check.action]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="test-group-history">
        <summary>
          历史执行记录（{execution.records.length}）— 点击展开或收起
        </summary>
        {execution.records.length === 0 ? (
          <p className="prototype-muted">当前测试组还没有自动化执行记录。</p>
        ) : (
          <div className="prototype-execution-records">
            {execution.records.map((record) => (
              <V020ExecutionRecordCard key={record.id} record={record} />
            ))}
          </div>
        )}
      </details>
      <p className="prototype-inline-note">
        “已完成”表示所有计划项都已完成尝试，不要求全部通过；再次执行会创建新的不可覆盖记录。
      </p>
    </section>
  );
}
