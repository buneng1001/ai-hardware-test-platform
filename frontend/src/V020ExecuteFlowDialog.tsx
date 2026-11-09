import { useEffect, useRef, useState } from "react";

import { V020ConfirmDialog } from "./V020ConfirmDialog";

/** 演示版的执行流程步骤。 */
type FlowStep = "generate" | "review" | "running" | "done";

type Issue = { level: "blocking" | "warning"; message: string };

export type ExecuteFlowGroup = {
  id: number;
  name: string;
  automationCount: number;
  packageCount: number;
};

/**
 * 执行自动化测试的完整演示流程：
 * 生成可执行用例（JSON）→ 校验/人工审核 → 触发执行器 → 回收结果。
 * 全部为前端模拟，不请求后端，也不真的连接 CI。
 */
export function V020ExecuteFlowDialog({
  group,
  runnerName,
  onClose,
  onFinished,
}: {
  group: ExecuteFlowGroup | null;
  runnerName: string | null;
  onClose: () => void;
  onFinished: (message: string) => void;
}) {
  const [step, setStep] = useState<FlowStep>("generate");
  const [scope, setScope] = useState<"all" | "missing" | "selected">("missing");
  const [format, setFormat] = useState<"platform" | "pytest">("platform");
  const [generated, setGenerated] = useState<{
    cases: number;
    bytes: number;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [timeline, setTimeline] = useState<
    Array<{ label: string; done: boolean }>
  >([
    { label: "已触发执行器", done: false },
    { label: "执行器已拉取用例与数据包", done: false },
    { label: "用例执行中", done: false },
    { label: "回收结果文件", done: false },
  ]);
  const [result, setResult] = useState<{
    passed: number;
    failed: number;
    blocked: number;
    notExecuted: number;
  } | null>(null);
  const timerRef = useRef<number | null>(null);

  // 每次打开都从第一步开始，避免残留上一次的执行状态。
  useEffect(() => {
    if (group) {
      setStep("generate");
      setGenerated(null);
      setConfirmed(false);
      setTimeline((current) =>
        current.map((item) => ({ ...item, done: false })),
      );
      setResult(null);
    }
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [group]);

  if (!group) return null;

  const blockingIssues: Issue[] = [];
  const warningIssues: Issue[] = [];
  if (group.packageCount < group.automationCount) {
    blockingIssues.push({
      level: "blocking",
      message: `${group.automationCount - group.packageCount} 条自动化用例还没有分配数据包，无法执行`,
    });
  }
  if (group.automationCount === 0) {
    blockingIssues.push({
      level: "blocking",
      message: "这个测试组还没有自动化用例",
    });
  }

  const generate = () => {
    const cases =
      scope === "all"
        ? group.automationCount
        : scope === "selected"
          ? Math.min(group.automationCount, 5)
          : group.automationCount;
    // 模拟生成一个 JSON 文件的大小；真实实现会写入磁盘。
    setGenerated({ cases, bytes: 600 + cases * 420 });
    setStep("review");
  };

  const publishAndRun = () => {
    setStep("running");
    let index = 0;
    timerRef.current = window.setInterval(() => {
      index += 1;
      setTimeline((current) =>
        current.map((item, position) => ({
          ...item,
          done: position < index,
        })),
      );
      if (index >= 4) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        const total = Math.max(group.automationCount, 1);
        const failed = Math.round(total * 0.2);
        const blocked = Math.round(total * 0.05);
        const passed = total - failed - blocked;
        setResult({ passed, failed, blocked, notExecuted: 0 });
        setStep("done");
      }
    }, 700);
  };

  const closeAndFinish = () => {
    if (result) {
      onFinished(
        `执行完成：通过 ${result.passed} · 失败 ${result.failed} · 阻塞 ${result.blocked} · 未执行 ${result.notExecuted}`,
      );
    }
    onClose();
  };

  const cancelRun = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    onFinished("已取消本次测试，执行器侧结果不会回传。");
    onClose();
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
          执行器：{runnerName ?? "未选择"} ·{" "}
          {step === "generate" && "第 1 步：生成可执行用例"}
          {step === "review" && "第 2 步：校验与人工审核"}
          {step === "running" && "第 3 步：执行中"}
          {step === "done" && "第 4 步：结果已回收"}
        </p>

        {step === "generate" && (
          <>
            <label>
              生成范围
              <select
                aria-label="生成范围"
                onChange={(event) =>
                  setScope(event.target.value as typeof scope)
                }
                value={scope}
              >
                <option value="missing">只生成还没生成过的用例（推荐）</option>
                <option value="all">全部自动化用例</option>
                <option value="selected">只生成当前勾选的用例</option>
              </select>
            </label>
            <label>
              用例格式
              <select
                aria-label="用例格式"
                onChange={(event) =>
                  setFormat(event.target.value as typeof format)
                }
                value={format}
              >
                <option value="platform">平台标准 JSON</option>
                <option value="pytest">pytest 参数化模板</option>
              </select>
            </label>
            <div className="prototype-actions">
              <button
                className="prototype-primary"
                disabled={group.automationCount === 0}
                onClick={generate}
                type="button"
              >
                生成可执行用例
              </button>
              <button
                className="prototype-secondary"
                onClick={onClose}
                type="button"
              >
                取消
              </button>
            </div>
          </>
        )}

        {step === "review" && generated && (
          <>
            <p>
              已生成 <strong>{generated.cases}</strong> 条可执行用例， 约{" "}
              {Math.round(generated.bytes / 1024)} KB。
            </p>
            <p className="prototype-muted">
              下面是文件开头的一条示例；完整文件含全部 {generated.cases}{" "}
              条用例，结构相同。
            </p>
            <pre className="prototype-json-preview">{`{
  "group": "${group.name}",
  "runner": "${runnerName ?? "未选择"}",
  "format": "${format}",
  "cases": [
    { "case_number": "AUTO-000001", "package": "DP-000001",
      "assert": { "metric": "frame_rate", "op": ">=", "value": 30 } }
  ]
}`}</pre>
            <h4>校验结果</h4>
            <ul className="prototype-issue-list">
              {blockingIssues.map((issue) => (
                <li className="is-blocking" key={issue.message}>
                  阻断：{issue.message}
                </li>
              ))}
              {warningIssues.map((issue) => (
                <li className="is-warning" key={issue.message}>
                  警告：{issue.message}
                </li>
              ))}
              {blockingIssues.length === 0 && (
                <li className="is-ok">
                  结构校验通过，没有阻断问题。上面只展示 1 条示例，其余{" "}
                  {generated.cases - 1} 条按同样结构生成，不需要逐条查看。
                </li>
              )}
            </ul>
            <label className="prototype-inline-check">
              <input
                aria-label="已人工确认"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                type="checkbox"
              />
              我已人工确认内容，跳过逐条审核
            </label>
            <div className="prototype-actions">
              <button
                className="prototype-primary"
                disabled={blockingIssues.length > 0 || !confirmed}
                onClick={publishAndRun}
                type="button"
              >
                发布并执行
              </button>
              <button
                className="prototype-secondary"
                onClick={() => setStep("generate")}
                type="button"
              >
                返回修改
              </button>
            </div>
          </>
        )}

        {step === "running" && (
          <>
            <ul className="prototype-run-timeline">
              {timeline.map((item) => (
                <li className={item.done ? "is-done" : ""} key={item.label}>
                  {item.done ? "✓" : "…"} {item.label}
                </li>
              ))}
            </ul>
            <div className="prototype-actions">
              <button
                className="prototype-secondary"
                onClick={cancelRun}
                type="button"
              >
                取消本次测试
              </button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <>
            <p className="prototype-run-result">
              通过 {result.passed} · 失败 {result.failed} · 阻塞{" "}
              {result.blocked} · 未执行 {result.notExecuted}
            </p>
            <p className="prototype-muted">
              结果文件已回传，执行记录和最终报告可以直接使用。
            </p>
            <div className="prototype-actions">
              <button
                className="prototype-primary"
                onClick={closeAndFinish}
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
