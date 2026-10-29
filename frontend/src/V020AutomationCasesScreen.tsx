import { useCallback, useEffect, useRef, useState } from "react";

import { V020AutomationCaseCreateForm } from "./V020AutomationCaseCreateForm";
import { V020AutomationCaseTable } from "./V020AutomationCaseTable";
import type { AutomationCaseCreateCommand } from "./automationTestCasesApi";
import { useV020AutomationTestCases } from "./useV020AutomationTestCases";
import "./V020AutomationCases.css";

/**
 * 冻结版“自动化用例表”页：读取真实规则候选，支持编辑、新增、删除、
 * 反馈、校验和历史，并补齐加载、空、失败与重试状态。
 */
export function V020AutomationCasesScreen({
  versionId,
  onOpenGroups,
  onOpenSource,
}: {
  versionId: number | null;
  onOpenGroups: () => void;
  onOpenSource: (sourceTestCaseId: number) => void;
}) {
  const automation = useV020AutomationTestCases(versionId);
  const [showCreate, setShowCreate] = useState(false);
  const [createDirty, setCreateDirty] = useState(false);
  const [dirtyCaseIds, setDirtyCaseIds] = useState<number[]>([]);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const submitHandlers = useRef(new Map<number, () => Promise<boolean>>());

  const registerSubmit = useCallback(
    (caseId: number, submit: (() => Promise<boolean>) | null) => {
      if (submit) submitHandlers.current.set(caseId, submit);
      else submitHandlers.current.delete(caseId);
    },
    [],
  );

  /** 一次保存所有已修改行；没有修改时明确提示，不发送空请求。 */
  const submitAll = async () => {
    const handlers = [...submitHandlers.current.values()];
    if (handlers.length === 0) {
      setBatchMessage("没有需要提交的修改。");
      return;
    }
    setBatchMessage(null);
    let submitted = 0;
    for (const submit of handlers) {
      if (!(await submit())) return;
      submitted += 1;
    }
    setBatchMessage(`已提交 ${submitted} 条修改。`);
  };

  const handleDirtyChange = useCallback((caseId: number, dirty: boolean) => {
    setDirtyCaseIds((current) => {
      const exists = current.includes(caseId);
      if (dirty === exists) return current;
      return dirty
        ? [...current, caseId]
        : current.filter((id) => id !== caseId);
    });
  }, []);

  const hasUnsavedChanges = dirtyCaseIds.length > 0 || createDirty;
  useEffect(() => {
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "自动化用例存在未保存修改";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasUnsavedChanges]);

  if (versionId === null) {
    return (
      <div className="prototype-inline-note">
        请先在“版本与趋势”中打开一个产品版本，再生成自动化用例候选。
      </div>
    );
  }

  if (automation.status === "loading" || automation.status === "idle") {
    return (
      <p className="prototype-muted" role="status">
        正在加载自动化用例…
      </p>
    );
  }

  if (automation.status === "error") {
    return (
      <div className="prototype-inline-note" role="alert">
        自动化用例加载失败：{automation.error}
        <button
          className="prototype-secondary"
          onClick={automation.retry}
          type="button"
        >
          重试
        </button>
      </div>
    );
  }

  const failedCount = automation.items.filter(
    (item) => item.conversion_status === "failed",
  ).length;
  const allValidated =
    automation.items.length > 0 &&
    automation.items.every((item) => item.validation_status === "passed");

  const createCase = async (command: AutomationCaseCreateCommand) => {
    const created = await automation.createCase(command);
    if (created) setShowCreate(false);
    return created;
  };

  const deleteCase = async (caseId: number) => {
    const removed = await automation.deleteCase(caseId);
    if (removed) {
      setDirtyCaseIds((current) => current.filter((id) => id !== caseId));
    }
    return removed;
  };

  return (
    <>
      <div className="prototype-case-toolbar prototype-automation-toolbar">
        <p className="prototype-muted">
          规则转换不依赖 AI；共 {automation.items.length} 条候选，其中转换失败
          {failedCount} 条，全部需要人工审核。
        </p>
        <div className="prototype-actions">
          <button
            disabled={automation.busy}
            onClick={() => void automation.convert()}
            type="button"
          >
            生成自动化用例
          </button>
          <button
            className="prototype-secondary"
            disabled={automation.busy}
            onClick={() => setShowCreate((current) => !current)}
            type="button"
          >
            {showCreate ? "收起新增" : "新增自动化用例"}
          </button>
          <button
            className="prototype-secondary"
            disabled={automation.busy || automation.items.length === 0}
            onClick={() => void automation.validateCases()}
            type="button"
          >
            校验自动化用例
          </button>
          <button
            className="prototype-secondary"
            disabled={automation.busy || dirtyCaseIds.length === 0}
            onClick={() => void submitAll()}
            type="button"
          >
            批量保存修改
          </button>
          <button
            className="prototype-secondary"
            disabled={automation.busy}
            onClick={automation.retry}
            type="button"
          >
            刷新
          </button>
          <button
            className="prototype-secondary"
            disabled={!allValidated}
            onClick={onOpenGroups}
            title={
              allValidated ? undefined : "请先校验全部自动化用例再加入测试组"
            }
            type="button"
          >
            加入测试组
          </button>
        </div>
      </div>

      {automation.actionError && (
        <div className="prototype-inline-note" role="alert">
          {automation.actionError}
        </div>
      )}
      {automation.message && (
        <p className="prototype-muted" role="status">
          {automation.message}
        </p>
      )}
      {batchMessage && (
        <p className="prototype-muted" role="status">
          {batchMessage}
        </p>
      )}

      {showCreate && (
        <V020AutomationCaseCreateForm
          busy={automation.busy}
          onCancel={() => setShowCreate(false)}
          onDirtyChange={setCreateDirty}
          onSubmit={createCase}
        />
      )}

      {automation.items.length === 0 ? (
        <div className="prototype-card">
          <h3>还没有自动化用例候选</h3>
          <p className="prototype-muted">
            先导入原始测试用例，再点击“生成自动化用例”。规则转换可离线运行，不需要模型或
            Skill。
          </p>
        </div>
      ) : (
        <V020AutomationCaseTable
          busy={automation.busy}
          items={automation.items}
          productVersionId={versionId}
          onDelete={deleteCase}
          onDirtyChange={handleDirtyChange}
          onFeedback={automation.submitFeedback}
          onOpenSource={onOpenSource}
          onRegisterSubmit={registerSubmit}
          onRegenerate={automation.regenerateCase}
          onSave={automation.updateCase}
        />
      )}

      <div className="prototype-inline-note">
        修改、新增、删除或重新生成后，用例立即变为未校验；未校验用例不能加入测试组或执行。删除资产不会删除历史快照。
      </div>
    </>
  );
}
