import { useEffect, useState } from "react";

import {
  getAutomationCaseHistory,
  submitAutomationCaseFeedback,
  type AutomationCaseHistory,
  type AutomationTestCase,
  type AutomationTestCaseDraft,
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

export function AutomationTestCaseRow({
  item,
  productVersionId,
  busy,
  onSave,
  onRegenerate,
  onDelete,
  onDirtyChange,
  onError,
}: {
  item: AutomationTestCase;
  productVersionId: number;
  busy: boolean;
  onSave: (id: number, draft: AutomationTestCaseDraft) => Promise<void>;
  onRegenerate: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onDirtyChange: (caseId: number, dirty: boolean) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => draftFor(item));
  const [feedback, setFeedback] = useState(item.feedback_input);
  const [history, setHistory] = useState<AutomationCaseHistory | null>(null);
  const draftChanged = JSON.stringify(draft) !== JSON.stringify(draftFor(item));
  const changed = draftChanged || Boolean(feedback.trim());

  useEffect(() => setDraft(draftFor(item)), [item]);
  useEffect(
    () => onDirtyChange(item.id, changed),
    [changed, item.id, onDirtyChange],
  );

  const sendFeedback = async () => {
    if (!feedback.trim()) return;
    try {
      await submitAutomationCaseFeedback(productVersionId, item.id, feedback);
      setFeedback("");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "AI 反馈提交失败");
    }
  };

  const loadHistory = async () => {
    try {
      setHistory(await getAutomationCaseHistory(productVersionId, item.id));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "转换历史加载失败");
    }
  };

  return (
    <article
      className={`automation-case-row automation-case-row--${item.conversion_status}`}
      role="listitem"
    >
      <header className="automation-case-row-header">
        <strong>{item.case_number}</strong>
        <a href={`#source-test-case-${item.source_test_case_id}`}>
          {item.source_case_number}
        </a>
        <span>
          {item.conversion_status === "failed"
            ? "转换失败"
            : item.conversion_status === "manual"
              ? "人工新增"
              : "低可信度候选"}
        </span>
        <span>{item.validation_status === "passed" ? "已校验" : "未校验"}</span>
        <small>{item.review_note}</small>
      </header>
      <div className="automation-case-editor">
        {fields.map(([field, label]) => (
          <label key={field}>
            {label}
            <textarea
              aria-label={`${item.case_number} ${label}`}
              disabled={busy}
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
        <label className="automation-feedback">
          AI 反馈（独立字段）
          <textarea
            aria-label={`${item.case_number} AI 反馈`}
            disabled={busy}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
        </label>
      </div>
      {item.validation_message && <p role="alert">{item.validation_message}</p>}
      <div className="workspace-actions">
        <button
          type="button"
          disabled={busy || !draftChanged}
          onClick={() => void onSave(item.id, draft)}
        >
          保存修改
        </button>
        <button
          type="button"
          disabled={busy || !feedback.trim()}
          onClick={() => void sendFeedback()}
        >
          提交 AI 反馈
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRegenerate(item.id)}
        >
          重新生成
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDelete(item.id)}
        >
          删除用例
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void loadHistory()}
        >
          查看转换历史
        </button>
      </div>
      {history && (
        <details open className="automation-case-history">
          <summary>原始内容与转换历史</summary>
          <p>
            原始用例：{history.source.case_number} — {history.source.title}
          </p>
          <ul>
            {history.items.map((entry) => (
              <li key={entry.id}>
                {entry.event_type}（{entry.created_at}）
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
