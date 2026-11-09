import { useEffect } from "react";

import type { V020ProjectWorkspace } from "./useV020ProjectWorkspace";
import "./V020DeletionImpactPanel.css";

/**
 * 删除影响弹窗：项目列表和版本与趋势页共用同一份确认视图。
 * 用覆盖整个页面的弹窗呈现，让用户立刻感知到“点下去会发生什么”，
 * 而不是在页面底部插入一块需要自己去找的确认区。
 */
export function V020DeletionImpactPanel({
  workspace,
}: {
  workspace: V020ProjectWorkspace;
}) {
  const pending = workspace.pendingDeletion;

  /** 弹窗打开时支持 Esc 关闭，避免用户被前台弹窗困住。 */
  useEffect(() => {
    if (!pending) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") workspace.cancelDeletion();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, workspace]);

  if (!pending) return null;

  const versions =
    pending.kind === "project"
      ? pending.impact.product_versions
      : [pending.impact.product_version];
  const counts = pending.impact.asset_counts;
  const total = pending.impact.total_affected_assets;

  return (
    <div className="prototype-modal-backdrop">
      <div
        aria-label="删除影响确认"
        aria-modal="true"
        className="prototype-modal"
        role="dialog"
      >
        <h3>{pending.kind === "project" ? "删除项目" : "删除产品版本"}</h3>
        <p>删除前确认影响范围，确认后立即执行且不可恢复。</p>
        <p>
          涉及 {versions.length} 个产品版本：
          {versions.map((item) => item.version).join("、") || "无"}
        </p>
        <p className="prototype-muted">
          源用例 {counts.source_test_cases} · 自动化用例{" "}
          {counts.automation_test_cases} · 数据包 {counts.data_packages} ·
          测试组 {counts.test_groups} · 执行记录{" "}
          {counts.automation_execution_records} · 人工结果{" "}
          {counts.manual_test_results} · 在线报告 {counts.online_reports}
        </p>
        <p>
          共影响 <strong>{total}</strong> 项资产，删除后不可恢复。
        </p>
        <div className="prototype-actions">
          <button
            className="prototype-secondary"
            disabled={workspace.busy}
            onClick={workspace.cancelDeletion}
            type="button"
          >
            取消
          </button>
          <button
            className="prototype-danger"
            disabled={workspace.busy}
            onClick={() => void workspace.confirmDeletion()}
            type="button"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}
