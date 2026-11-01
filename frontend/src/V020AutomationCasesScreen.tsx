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
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const submitHandlers = useRef(new Map<number, () => Promise<boolean>>());
  const pageSize = 20;

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

  useEffect(() => {
    setPage(1);
  }, [automation.items]);

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
  const totalPages = Math.max(1, Math.ceil(automation.items.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = automation.items.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const toggleSelect = (caseId: number) =>
    setSelectedIds((current) =>
      current.includes(caseId)
        ? current.filter((id) => id !== caseId)
        : [...current, caseId],
    );
  // 一次选中当前全部用例（跨页），再点一次取消，不需要逐页全选。
  const allSelected =
    automation.items.length > 0 &&
    automation.items.every((item) => selectedIds.includes(item.id));
  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? [] : automation.items.map((item) => item.id));
  const selectedItems = automation.items.filter((item) =>
    selectedIds.includes(item.id),
  );
  const selectedValidated =
    selectedItems.length > 0 &&
    selectedItems.every((item) => item.validation_status === "passed");

  /** 加入测试组前如果勾选还没校验，先自动校验一次，避免按钮“能选不能用”。 */
  const joinSelectedToGroup = async () => {
    if (selectedItems.length === 0) return;
    if (!selectedValidated) {
      const passed = await automation.validateCases();
      if (!passed) {
        setBatchMessage("勾选的用例还没通过校验，请先修改后再加入测试组。");
        return;
      }
    }
    onOpenGroups();
  };

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
          共 {automation.items.length} 条候选，其中转换失败 {failedCount}{" "}
          条，已选 {selectedIds.length}{" "}
          条。生成入口在“测试用例表”，这里只做编辑、校验和加入测试组。
        </p>
        <div className="prototype-actions">
          <button
            aria-pressed={allSelected}
            className={allSelected ? "is-selected" : "prototype-secondary"}
            disabled={automation.items.length === 0}
            onClick={toggleSelectAll}
            type="button"
          >
            {allSelected ? "取消选择" : "全选"}
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
            disabled={selectedItems.length === 0}
            onClick={() => void joinSelectedToGroup()}
            title={
              selectedItems.length === 0
                ? "先勾选要加入测试组的自动化用例"
                : "带当前勾选的自动化用例进入测试组"
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
            先到“测试用例表”导入原始用例，再点“AI
            生成自动化用例”或“规则转换（不使用 AI）”。
          </p>
        </div>
      ) : (
        <>
          <V020AutomationCaseTable
            busy={automation.busy}
            items={pageItems}
            productVersionId={versionId}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onDelete={deleteCase}
            onDirtyChange={handleDirtyChange}
            onFeedback={automation.submitFeedback}
            onOpenSource={onOpenSource}
            onRegisterSubmit={registerSubmit}
            onRegenerate={automation.regenerateCase}
            onSave={automation.updateCase}
          />
          {automation.items.length > pageSize && (
            <div className="prototype-source-pager" aria-label="自动化用例分页">
              <span>
                第 {currentPage} / {totalPages} 页 · 共{" "}
                {automation.items.length} 条，每页 {pageSize} 条
              </span>
              <button
                className="prototype-secondary"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                type="button"
              >
                上一页
              </button>
              <button
                className="prototype-secondary"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
                type="button"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}

      <div className="prototype-inline-note">
        修改、新增、删除或重新生成后，用例立即变为未校验；未校验用例不能加入测试组或执行。删除资产不会删除历史快照。
      </div>
    </>
  );
}
