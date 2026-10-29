import { useEffect, useState } from "react";

import type { AutomationCaseCreateCommand } from "./automationTestCasesApi";

const emptyCommand: AutomationCaseCreateCommand = {
  source_case_number: "",
  title: "",
  input: "",
  steps: "",
  expected_result: "",
};

const textFields: Array<[keyof AutomationCaseCreateCommand, string]> = [
  ["title", "标题"],
  ["input", "输入"],
  ["steps", "操作步骤"],
  ["expected_result", "预期结果"],
];

/** 冻结版新增区：自动化编号由系统生成，来源编号必须属于当前产品版本。 */
export function V020AutomationCaseCreateForm({
  busy,
  onSubmit,
  onCancel,
  onDirtyChange,
}: {
  busy: boolean;
  onSubmit: (command: AutomationCaseCreateCommand) => Promise<boolean>;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [command, setCommand] =
    useState<AutomationCaseCreateCommand>(emptyCommand);
  const dirty = Object.values(command).some((value) => value.trim() !== "");

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const submit = async () => {
    if (!command.source_case_number.trim()) return;
    if (await onSubmit(command)) setCommand(emptyCommand);
  };

  return (
    <form
      className="prototype-card prototype-automation-create"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3>新增自动化用例</h3>
      <p className="prototype-muted">
        自动化编号由系统生成且不可编辑；来源编号必须属于当前产品版本。
      </p>
      <div className="prototype-automation-editor-grid">
        <label>
          来源用例编号
          <input
            aria-label="来源用例编号"
            disabled={busy}
            required
            value={command.source_case_number}
            onChange={(event) =>
              setCommand((current) => ({
                ...current,
                source_case_number: event.target.value,
              }))
            }
          />
        </label>
        {textFields.map(([field, label]) => (
          <label key={field}>
            {label}
            <textarea
              aria-label={`新增自动化用例 ${label}`}
              disabled={busy}
              rows={2}
              value={command[field]}
              onChange={(event) =>
                setCommand((current) => ({
                  ...current,
                  [field]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>
      <div className="prototype-actions">
        <button
          className="prototype-primary"
          disabled={busy || !command.source_case_number.trim()}
        >
          新增自动化用例
        </button>
        <button
          className="prototype-secondary"
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
  );
}
