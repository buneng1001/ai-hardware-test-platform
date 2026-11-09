import { useState } from "react";

import { V020ConfirmDialog } from "./V020ConfirmDialog";

export type AiGenerateMode = "missing" | "all" | "selected";

/**
 * AI 生成自动化用例前的范围选择。
 * 让用户在生成前就决定“要不要连已经自动化的用例一起重判”，避免生成完才发现重叠。
 */
export function V020AiGenerateDialog({
  open,
  totalCount,
  missingCount,
  selectedCount,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  totalCount: number;
  missingCount: number;
  selectedCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (mode: AiGenerateMode) => void;
}) {
  // 默认选“还没生成过自动化”的用例；只有当用户只勾选了一部分时才默认按勾选处理。
  const [mode, setMode] = useState<AiGenerateMode>(
    selectedCount > 0 && selectedCount < totalCount ? "selected" : "missing",
  );

  if (!open) return null;

  const options: Array<{
    value: AiGenerateMode;
    label: string;
    hint: string;
    count: number;
    disabled: boolean;
  }> = [
    {
      value: "missing",
      label: "只处理还没生成自动化的用例（推荐）",
      hint: "已自动化的用例会被跳过，不会重复生成。",
      count: missingCount,
      disabled: missingCount === 0,
    },
    {
      value: "all",
      label: "全部用例重新判定",
      hint: "包括已经自动化的用例，会按本次结果新增或移除自动化版本。",
      count: totalCount,
      disabled: totalCount === 0,
    },
    {
      value: "selected",
      label: "只处理当前勾选的用例",
      hint: "适合你手动挑出一小批重新判定。",
      count: selectedCount,
      disabled: selectedCount === 0,
    },
  ];

  const chosen = options.find((item) => item.value === mode) ?? options[0];

  return (
    <V020ConfirmDialog
      ariaLabel="AI 生成自动化用例范围"
      busy={busy || chosen.disabled}
      confirmLabel={busy ? "判定中…" : `开始判定（${chosen.count} 条）`}
      onCancel={onCancel}
      onConfirm={() => onConfirm(mode)}
      title="用 AI 生成自动化用例"
    >
      <p className="prototype-muted">
        生成范围决定哪些用例会被模型重新判定。判为自动化的会生成自动化用例，
        判为人工的会给出原因，方便你复核。
      </p>
      <div className="prototype-ai-scope">
        {options.map((option) => (
          <label
            className={
              option.disabled
                ? "prototype-ai-scope-option is-disabled"
                : "prototype-ai-scope-option"
            }
            key={option.value}
          >
            <input
              aria-label={option.label}
              checked={mode === option.value}
              disabled={option.disabled || busy}
              onChange={() => setMode(option.value)}
              type="radio"
            />
            <span>
              <strong>
                {option.label}（{option.count} 条）
              </strong>
              <small>{option.hint}</small>
            </span>
          </label>
        ))}
      </div>
    </V020ConfirmDialog>
  );
}
