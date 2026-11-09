import type { ReactNode } from "react";

import "./V020DeletionImpactPanel.css";

/**
 * 统一的确认弹窗外壳：遮罩 + 居中卡片。
 * 所有删除/危险操作都用它，避免出现“页面底下冒出一个确认框”。
 */
export function V020ConfirmDialog({
  ariaLabel,
  title,
  children,
  confirmLabel,
  cancelLabel = "取消",
  busy = false,
  onCancel,
  onConfirm,
}: {
  ariaLabel: string;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="prototype-modal-backdrop">
      <section
        aria-label={ariaLabel}
        aria-modal="true"
        className="prototype-modal"
        role="dialog"
      >
        <h3>{title}</h3>
        {children}
        <div className="prototype-actions">
          <button
            className="prototype-secondary"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="prototype-primary"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
