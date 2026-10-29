import { useEffect, useState } from "react";

import type {
  AutomationTestCase,
  AutomationTestCaseDraft,
} from "./automationTestCasesApi";

const fields: Array<[keyof AutomationTestCaseDraft, string]> = [
  ["title", "标题"],
  ["input", "输入"],
  ["steps", "操作步骤"],
  ["expected_result", "预期结果"],
];

function draftFor(item: AutomationTestCase): AutomationTestCaseDraft {
  return {
    title: item.title,
    input: item.input,
    steps: item.steps,
    expected_result: item.expected_result,
  };
}

/** 冻结版行内编辑器：人工修改与 AI 反馈使用两个独立输入区。 */
export function V020AutomationCaseEditor({
  item,
  busy,
  onSave,
  onFeedback,
  onDirtyChange,
  onRegisterSubmit,
}: {
  item: AutomationTestCase;
  busy: boolean;
  onSave: (caseId: number, draft: AutomationTestCaseDraft) => Promise<boolean>;
  onFeedback: (caseId: number, feedback: string) => Promise<boolean>;
  onDirtyChange: (caseId: number, dirty: boolean) => void;
  onRegisterSubmit: (
    caseId: number,
    submit: (() => Promise<boolean>) | null,
  ) => void;
}) {
  const [draft, setDraft] = useState(() => draftFor(item));
  const [feedback, setFeedback] = useState(item.feedback_input);

  useEffect(() => setDraft(draftFor(item)), [item]);
  const draftChanged = JSON.stringify(draft) !== JSON.stringify(draftFor(item));
  const dirty = draftChanged || feedback !== item.feedback_input;
  useEffect(() => {
    onDirtyChange(item.id, dirty);
    return () => onDirtyChange(item.id, false);
  }, [dirty, item.id, onDirtyChange]);

  // 批量保存入口按需注册，未修改的行不参与批量提交。
  useEffect(() => {
    if (!dirty) {
      onRegisterSubmit(item.id, null);
      return;
    }
    const submit = async () => {
      let ok = true;
      if (draftChanged) ok = await onSave(item.id, draft);
      if (ok && feedback.trim() && feedback !== item.feedback_input) {
        ok = await onFeedback(item.id, feedback);
        if (ok) setFeedback("");
      }
      return ok;
    };
    onRegisterSubmit(item.id, submit);
    return () => onRegisterSubmit(item.id, null);
  }, [
    dirty,
    draft,
    draftChanged,
    feedback,
    item,
    onSave,
    onFeedback,
    onRegisterSubmit,
  ]);

  const save = async () => {
    if (await onSave(item.id, draft)) setDraft(draftFor(item));
  };

  const sendFeedback = async () => {
    if (!feedback.trim()) return;
    if (await onFeedback(item.id, feedback)) setFeedback("");
  };

  return (
    <div className="prototype-automation-editor">
      <div className="prototype-automation-editor-grid">
        {fields.map(([field, label]) => (
          <label key={field}>
            {label}
            <textarea
              aria-label={`${item.case_number} ${label}`}
              disabled={busy}
              rows={2}
              value={draft[field]}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [field]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>
      <label className="prototype-automation-feedback">
        AI 反馈（独立字段，不修改上面的用例内容）
        <textarea
          aria-label={`${item.case_number} AI 反馈`}
          disabled={busy}
          rows={2}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
        />
      </label>
      {item.feedback_status === "unavailable" && (
        <p
          className="prototype-row-note prototype-row-note--warning"
          role="status"
        >
          AI 反馈不可用：已保留输入，可稍后重试或人工修改。
        </p>
      )}
      {item.validation_message && (
        <p
          className="prototype-row-note prototype-row-note--warning"
          role="alert"
        >
          {item.validation_message}
        </p>
      )}
      <div className="prototype-actions">
        <button
          className="prototype-primary"
          disabled={busy || !draftChanged}
          onClick={() => void save()}
          type="button"
        >
          保存修改
        </button>
        <button
          className="prototype-secondary"
          disabled={busy || !feedback.trim()}
          onClick={() => void sendFeedback()}
          type="button"
        >
          提交 AI 反馈
        </button>
      </div>
    </div>
  );
}
