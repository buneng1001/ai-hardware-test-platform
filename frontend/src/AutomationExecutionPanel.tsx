import { useEffect, useState } from "react";

import {
  listAutomationExecutions,
  prepareAutomationExecution,
  startAutomationExecution,
  type AutomationExecution,
  type PreparationCheck,
} from "./automationExecutionsApi";

const resultLabel = {
  passed: "通过",
  failed: "失败",
  blocked: "阻塞",
  not_executed: "未执行",
};

export function AutomationExecutionPanel({
  groupId,
  onOpenManual,
}: {
  groupId: number;
  onOpenManual?: () => void;
}) {
  const [records, setRecords] = useState<AutomationExecution[]>([]);
  const [checks, setChecks] = useState<PreparationCheck[] | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      setRecords((await listAutomationExecutions(groupId)).items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "执行记录刷新失败");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [groupId]);

  const prepare = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const preparation = await prepareAutomationExecution(groupId);
      setChecks(preparation.checks);
      setReady(preparation.passed);
      setMessage(
        preparation.passed
          ? "准备检查已通过，可以开始执行。"
          : "准备检查未通过，请按提示修复后重新检查。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "准备检查失败");
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const record = await startAutomationExecution(groupId);
      setRecords((current) => [record, ...current]);
      setReady(false);
      setChecks(null);
      setMessage(`自动化执行 #${record.execution_number} 已完成。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "自动化执行失败");
    } finally {
      setBusy(false);
    }
  };

  const cancelPreparation = () => {
    setChecks(null);
    setReady(false);
    setMessage("已取消准备流程，未创建正式执行记录。");
  };

  return (
    <section
      className="automation-execution-panel"
      aria-label="自动化执行与结果"
    >
      <h4>自动化执行与结果</h4>
      <p>执行模式：数据驱动模拟。只读取已校验数据包，不连接设备。</p>
      <div className="workspace-actions">
        <button type="button" disabled={busy} onClick={() => void prepare()}>
          开始准备检查
        </button>
        {ready && (
          <button type="button" disabled={busy} onClick={() => void execute()}>
            开始执行
          </button>
        )}
        {checks && (
          <button type="button" disabled={busy} onClick={cancelPreparation}>
            取消准备
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          刷新执行状态
        </button>
        {onOpenManual && (
          <button type="button" disabled={busy} onClick={onOpenManual}>
            录入人工结果
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {checks && checks.length > 0 && (
        <ul className="automation-preparation-checks">
          {checks.map((check) => (
            <li key={`${check.code}-${check.object_id}`}>
              <strong>{check.code}</strong> · 对象 #{check.object_id}：实际{" "}
              {check.actual}；期望 {check.expected}。{check.suggestion}{" "}
              <a href="#test-group-automation-scope">
                {check.action === "edit_group" ? "编辑测试组" : "替换数据包"}
              </a>
            </li>
          ))}
        </ul>
      )}
      {records.length === 0 ? (
        <p>尚无自动化执行记录。</p>
      ) : (
        <div className="automation-execution-records">
          {records.map((record) => (
            <article key={record.id}>
              <strong>自动化执行 #{record.execution_number}</strong>
              <p>
                状态：{record.status} · 通过 {record.summary.passed} · 失败{" "}
                {record.summary.failed} · 阻塞 {record.summary.blocked} · 未执行{" "}
                {record.summary.not_executed}
              </p>
              <ul>
                {record.case_results.map((result) => (
                  <li key={result.automation_test_case_id}>
                    {result.case_number}：{resultLabel[result.status]}（
                    {result.message}）
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
