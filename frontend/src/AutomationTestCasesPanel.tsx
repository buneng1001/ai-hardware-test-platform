import { useCallback, useEffect, useState } from "react";

import { AutomationTestCaseRow } from "./AutomationTestCaseRow";
import {
  convertSourceTestCasesWithRules,
  createAutomationTestCase,
  deleteAutomationTestCase,
  listAutomationTestCases,
  regenerateAutomationTestCase,
  updateAutomationTestCase,
  validateAutomationTestCases,
  type AutomationTestCase,
  type AutomationTestCaseDraft,
} from "./automationTestCasesApi";

const emptyDraft = {
  source_case_number: "",
  title: "",
  input: "",
  steps: "",
  expected_result: "",
};

export function AutomationTestCasesPanel({
  productVersionId,
}: {
  productVersionId: number;
}) {
  const [items, setItems] = useState<AutomationTestCase[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newCase, setNewCase] = useState(emptyDraft);
  const [dirtyIds, setDirtyIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    const result = await listAutomationTestCases(productVersionId);
    setItems(result.items);
  }, [productVersionId]);

  useEffect(() => {
    setItems([]);
    setError(null);
    setMessage(null);
    setNewCase(emptyDraft);
    setDirtyIds([]);
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "自动化用例加载失败"),
    );
  }, [load]);

  const hasUnsavedChanges =
    dirtyIds.length > 0 || Object.values(newCase).some(Boolean);
  useEffect(() => {
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "自动化用例存在未保存修改";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasUnsavedChanges]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "自动化用例操作失败");
    } finally {
      setBusy(false);
    }
  };

  const convert = () =>
    run(async () => {
      const result = await convertSourceTestCasesWithRules(productVersionId);
      setItems(result.items);
      setMessage(
        result.created_count
          ? `已生成 ${result.created_count} 条规则候选，均需人工审核。`
          : "所有原始用例都已有候选，未覆盖现有可编辑内容。",
      );
    });

  const create = () =>
    run(async () => {
      const saved = await createAutomationTestCase(productVersionId, newCase);
      setItems((current) => [...current, saved]);
      setNewCase(emptyDraft);
      setMessage("已新增自动化用例，尚未校验。");
    });

  const save = async (caseId: number, draft: AutomationTestCaseDraft) => {
    await run(async () => {
      const saved = await updateAutomationTestCase(
        productVersionId,
        caseId,
        draft,
      );
      setItems((current) =>
        current.map((item) => (item.id === caseId ? saved : item)),
      );
      setDirtyIds((current) => current.filter((id) => id !== caseId));
      setMessage("修改已保存，当前用例已变为未校验。");
    });
  };

  const remove = async (caseId: number) => {
    await run(async () => {
      await deleteAutomationTestCase(productVersionId, caseId);
      setItems((current) => current.filter((item) => item.id !== caseId));
      setDirtyIds((current) => current.filter((id) => id !== caseId));
      setMessage("自动化用例已删除；历史快照不受此操作影响。");
    });
  };

  const regenerate = async (caseId: number) => {
    await run(async () => {
      const saved = await regenerateAutomationTestCase(
        productVersionId,
        caseId,
      );
      setItems((current) =>
        current.map((item) => (item.id === caseId ? saved : item)),
      );
      setDirtyIds((current) => current.filter((id) => id !== caseId));
      setMessage("已按当前原始用例重新生成，当前用例已变为未校验。");
    });
  };

  const validate = () =>
    run(async () => {
      const result = await validateAutomationTestCases(productVersionId);
      setItems(result.items);
      setMessage(
        result.valid
          ? "自动化用例校验通过。"
          : "存在未通过校验的自动化用例，不能加入测试组或执行。",
      );
    });

  const setCaseDirty = useCallback((caseId: number, dirty: boolean) => {
    setDirtyIds((current) =>
      dirty
        ? [...new Set([...current, caseId])]
        : current.filter((id) => id !== caseId),
    );
  }, []);

  return (
    <section
      className="automation-case-panel"
      aria-labelledby="automation-cases-title"
    >
      <div className="automation-case-heading">
        <div>
          <h3 id="automation-cases-title">自动化用例表</h3>
          <p>
            规则转换不依赖 AI；AI 反馈适配器不可用时，反馈输入会保留在当前页面。
          </p>
        </div>
        <div className="workspace-actions">
          <button type="button" disabled={busy} onClick={() => void convert()}>
            规则转换原始用例
          </button>
          <button type="button" disabled={busy} onClick={() => void validate()}>
            校验自动化用例
          </button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <form
        className="automation-case-create"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <strong>新增自动化用例</strong>
        <label>
          来源用例编号
          <input
            required
            value={newCase.source_case_number}
            onChange={(event) =>
              setNewCase((current) => ({
                ...current,
                source_case_number: event.target.value,
              }))
            }
          />
        </label>
        <label>
          标题
          <input
            value={newCase.title}
            onChange={(event) =>
              setNewCase((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
          />
        </label>
        <label>
          输入
          <input
            value={newCase.input}
            onChange={(event) =>
              setNewCase((current) => ({
                ...current,
                input: event.target.value,
              }))
            }
          />
        </label>
        <label>
          操作步骤
          <input
            value={newCase.steps}
            onChange={(event) =>
              setNewCase((current) => ({
                ...current,
                steps: event.target.value,
              }))
            }
          />
        </label>
        <label>
          预期结果
          <input
            value={newCase.expected_result}
            onChange={(event) =>
              setNewCase((current) => ({
                ...current,
                expected_result: event.target.value,
              }))
            }
          />
        </label>
        <button type="submit" disabled={busy}>
          新增
        </button>
      </form>
      {items.length === 0 ? (
        <p className="workspace-empty">还没有自动化用例候选</p>
      ) : (
        <div className="automation-case-table" role="list">
          {items.map((item) => (
            <AutomationTestCaseRow
              busy={busy}
              item={item}
              key={item.id}
              productVersionId={productVersionId}
              onDelete={remove}
              onDirtyChange={setCaseDirty}
              onError={setError}
              onRegenerate={regenerate}
              onSave={save}
            />
          ))}
        </div>
      )}
    </section>
  );
}
