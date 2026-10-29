import { useState } from "react";

import { Status, TestSteps } from "./V020PrototypeShared";
import { V020AutomationCaseEditor } from "./V020AutomationCaseEditor";
import { V020AutomationCaseHistoryView } from "./V020AutomationCaseHistoryView";
import {
  getAutomationCaseHistory,
  type AutomationCaseHistory,
  type AutomationTestCase,
  type AutomationTestCaseDraft,
} from "./automationTestCasesApi";

function stepsOf(steps: string): string[] {
  return steps
    .split(/\r?\n/)
    .map((step) => step.trim())
    .filter(Boolean);
}

function validationLabel(item: AutomationTestCase): string {
  if (item.validation_status === "passed") return "已校验";
  if (item.validation_status === "failed") return "校验失败";
  return "未校验";
}

const emptyCell = <span className="prototype-muted">未生成</span>;

/** 冻结版自动化用例行：展示候选、行内编辑、AI 反馈和转换历史入口。 */
export function V020AutomationCaseRow({
  item,
  productVersionId,
  busy,
  onOpenSource,
  onSave,
  onFeedback,
  onRegenerate,
  onDelete,
  onDirtyChange,
  onRegisterSubmit,
}: {
  item: AutomationTestCase;
  productVersionId: number;
  busy: boolean;
  onOpenSource: (sourceTestCaseId: number) => void;
  onSave: (caseId: number, draft: AutomationTestCaseDraft) => Promise<boolean>;
  onFeedback: (caseId: number, feedback: string) => Promise<boolean>;
  onRegenerate: (caseId: number) => Promise<boolean>;
  onDelete: (caseId: number) => Promise<boolean>;
  onDirtyChange: (caseId: number, dirty: boolean) => void;
  onRegisterSubmit: (
    caseId: number,
    submit: (() => Promise<boolean>) | null,
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<AutomationCaseHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const failed = item.conversion_status === "failed";

  const toggleHistory = async () => {
    if (history) {
      setHistory(null);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(await getAutomationCaseHistory(productVersionId, item.id));
    } catch (caught) {
      setHistoryError(
        caught instanceof Error && caught.message
          ? caught.message
          : "转换历史加载失败",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <>
      <tr className={failed ? "prototype-row-warning" : undefined}>
        <td>{item.case_number}</td>
        <td>{item.title || emptyCell}</td>
        <td>
          <a
            href={`#source-test-case-${item.source_test_case_id}`}
            onClick={(event) => {
              event.preventDefault();
              onOpenSource(item.source_test_case_id);
            }}
          >
            {item.source_case_number}
          </a>
        </td>
        <td>{item.input || emptyCell}</td>
        <td>
          {stepsOf(item.steps).length > 0 ? (
            <TestSteps steps={stepsOf(item.steps)} />
          ) : (
            emptyCell
          )}
        </td>
        <td>{item.expected_result || emptyCell}</td>
        <td>
          <div className="prototype-automation-status">
            <Status tone={failed ? "warn" : "good"}>
              {failed
                ? "转换失败"
                : item.conversion_status === "manual"
                  ? "人工新增"
                  : "规则候选"}
            </Status>
            <Status
              tone={item.validation_status === "passed" ? "good" : "warn"}
            >
              {validationLabel(item)}
            </Status>
          </div>
          <p className="prototype-row-note">
            {failed ? item.review_note : `低可信度 · ${item.review_note}`}
          </p>
          {item.validation_message && (
            <p
              className="prototype-row-note prototype-row-note--warning"
              role="alert"
            >
              {item.validation_message}
            </p>
          )}
          {item.feedback_status === "unavailable" && (
            <p className="prototype-row-note">AI 反馈不可用（已保留输入）</p>
          )}
        </td>
        <td className="prototype-automation-actions">
          <button
            className="prototype-secondary"
            onClick={() => setEditing((current) => !current)}
            type="button"
          >
            {editing ? "收起编辑" : "编辑"}
          </button>
          <button
            className="prototype-secondary"
            disabled={historyLoading}
            onClick={() => void toggleHistory()}
            type="button"
          >
            {history ? "收起历史" : "查看历史"}
          </button>
          <button
            className="prototype-secondary"
            disabled={busy}
            onClick={() => void onRegenerate(item.id)}
            type="button"
          >
            重新生成
          </button>
          <button
            className="prototype-secondary"
            disabled={busy}
            onClick={() => void onDelete(item.id)}
            type="button"
          >
            删除
          </button>
        </td>
      </tr>
      {editing && (
        <tr className="prototype-automation-expanded">
          <td colSpan={8}>
            <V020AutomationCaseEditor
              item={item}
              busy={busy}
              onSave={onSave}
              onFeedback={onFeedback}
              onDirtyChange={onDirtyChange}
              onRegisterSubmit={onRegisterSubmit}
            />
          </td>
        </tr>
      )}
      {historyError && (
        <tr className="prototype-automation-expanded">
          <td colSpan={8}>
            <p role="alert">{historyError}</p>
          </td>
        </tr>
      )}
      {history && (
        <tr className="prototype-automation-expanded">
          <td colSpan={8}>
            <V020AutomationCaseHistoryView history={history} />
          </td>
        </tr>
      )}
    </>
  );
}
