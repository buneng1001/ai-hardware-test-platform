import { useEffect, useRef, useState } from "react";
import { V020ConfirmDialog } from "./V020ConfirmDialog";
import {
  prepareAutomationExecution,
  startAutomationExecution,
  type AutomationExecution,
  type PreparationCheck,
} from "./automationExecutionsApi";

type FlowStep = "prepare" | "review" | "running" | "done";
export type ExecuteFlowGroup = {
  id: number;
  name: string;
  automationCount: number;
  packageCount: number;
};

/** 正式后端数据驱动模拟：预检、人工确认、执行与持久化。未接入真实执行器。 */
export function V020ExecuteFlowDialog({
  group,
  runnerName,
  onClose,
  onFinished,
}: {
  group: ExecuteFlowGroup | null;
  runnerName: string | null;
  onClose: () => void;
  onFinished: (message: string, recordId?: number) => void;
}) {
  const [step, setStep] = useState<FlowStep>("prepare");
  const [checks, setChecks] = useState<PreparationCheck[]>([]);
  const [passed, setPassed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AutomationExecution | null>(null);
  const requestBusy = useRef(false);

  useEffect(() => {
    setStep("prepare");
    setChecks([]);
    setPassed(false);
    setConfirmed(false);
    setError("");
    setResult(null);
    setBusy(false);
    requestBusy.current = false;
  }, [group]);

  if (!group) return null;
  const prepare = async () => {
    if (requestBusy.current) return;
    requestBusy.current = true;
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      const preparation = await prepareAutomationExecution(group.id);
      setChecks(preparation.checks);
      setPassed(preparation.passed);
      setStep("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "准备检查失败");
    } finally {
      requestBusy.current = false;
      setBusy(false);
    }
  };
  const publishAndRun = async () => {
    if (requestBusy.current || !passed || !confirmed) return;
    requestBusy.current = true;
    setBusy(true);
    setError("");
    setStep("running");
    try {
      const record = await startAutomationExecution(group.id);
      setResult(record);
      setStep("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "执行失败");
      setStep("review");
      setConfirmed(false);
      setPassed(false);
    } finally {
      requestBusy.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="prototype-modal-backdrop">
      <section
        aria-label="执行自动化测试流程"
        aria-modal="true"
        className="prototype-modal prototype-execute-flow"
        role="dialog"
      >
        <h3>执行自动化测试 · {group.name}</h3>
        <p className="prototype-muted">
          执行模式：数据驱动模拟（不连接真实设备）
          {runnerName ? ` · 已配置执行器：${runnerName}（本次不调用）` : ""}
        </p>
        {error && (
          <p role="alert" className="prototype-inline-note">
            {error}
          </p>
        )}
        {step === "prepare" && (
          <>
            <p>
              本次执行当前测试组的全部 {group.automationCount}{" "}
              条自动化用例，使用已关联的数据包。开始前由后端校验用例和数据包。
            </p>
            <div className="prototype-actions">
              <button
                className="prototype-primary"
                disabled={busy || group.automationCount === 0}
                onClick={() => void prepare()}
                type="button"
              >
                {busy ? "正在预检…" : "开始准备检查"}
              </button>
              <button
                className="prototype-secondary"
                disabled={busy}
                onClick={onClose}
                type="button"
              >
                取消
              </button>
            </div>
          </>
        )}
        {step === "review" && (
          <>
            <h4>{passed ? "准备检查通过" : "准备检查未通过"}</h4>
            {checks.length > 0 && (
              <ul className="prototype-preparation-checks">
                {checks.map((check) => (
                  <li key={`${check.code}-${check.object_id}`}>
                    <strong>{check.code}</strong>
                    <span>
                      失败对象：{check.object_type} #{check.object_id}
                    </span>
                    <span>实际值：{check.actual}</span>
                    <span>期望值：{check.expected}</span>
                    <span>修复建议：{check.suggestion}</span>
                  </li>
                ))}
              </ul>
            )}
            {passed && (
              <label className="prototype-inline-check">
                <input
                  aria-label="已人工确认"
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />{" "}
                我已确认当前测试组与执行范围
              </label>
            )}
            <div className="prototype-actions">
              <button
                className="prototype-primary"
                disabled={busy || !passed || !confirmed}
                onClick={() => void publishAndRun()}
                type="button"
              >
                发布并执行
              </button>
              <button
                className="prototype-secondary"
                disabled={busy}
                onClick={() => setStep("prepare")}
                type="button"
              >
                返回准备
              </button>
              <button
                className="prototype-secondary"
                disabled={busy}
                onClick={onClose}
                type="button"
              >
                取消
              </button>
            </div>
          </>
        )}
        {step === "running" && (
          <p role="status">后端正在执行并保存记录，请勿重复提交。</p>
        )}
        {step === "done" && result && (
          <>
            <p>自动化执行 #{result.execution_number} · 记录已保存</p>
            <p className="prototype-run-result">
              通过 {result.summary.passed} · 失败 {result.summary.failed} · 阻塞{" "}
              {result.summary.blocked} · 未执行 {result.summary.not_executed}
            </p>
            <div className="prototype-actions">
              <button
                className="prototype-primary"
                onClick={() => {
                  onFinished(
                    `自动化执行 #${result.execution_number} 已保存：通过 ${result.summary.passed} · 失败 ${result.summary.failed} · 阻塞 ${result.summary.blocked} · 未执行 ${result.summary.not_executed}。`,
                    result.id,
                  );
                  onClose();
                }}
                type="button"
              >
                关闭并查看结果
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** 简单的结果提示弹窗，用于“未选择执行器”等前置条件不满足的场景。 */
export function V020FlowNoticeDialog({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  if (!message) return null;
  return (
    <V020ConfirmDialog
      ariaLabel="自动化执行提示"
      confirmLabel="知道了"
      onCancel={onClose}
      onConfirm={onClose}
      title="还不能执行自动化测试"
    >
      <p className="prototype-muted">{message}</p>
    </V020ConfirmDialog>
  );
}
