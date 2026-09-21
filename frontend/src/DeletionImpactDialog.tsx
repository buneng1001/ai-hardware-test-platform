import type { AssetCounts } from "./projectsApi";

const assetLabels: Array<[keyof AssetCounts, string]> = [
  ["source_test_cases", "原始测试用例"],
  ["automation_test_cases", "自动化测试用例"],
  ["data_packages", "数据包"],
  ["test_groups", "测试组"],
  ["automation_execution_records", "自动化执行记录"],
  ["manual_test_records", "人工测试记录"],
  ["online_reports", "在线报告"],
];

type DeletionImpactDialogProps = {
  target: "project" | "version";
  versions: Array<{ id: number; version: string; name: string }>;
  counts: AssetCounts;
  total: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeletionImpactDialog({
  target,
  versions,
  counts,
  total,
  busy,
  onCancel,
  onConfirm,
}: DeletionImpactDialogProps) {
  return (
    <div className="workspace-dialog-backdrop">
      <section
        className="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="删除影响范围"
      >
        <h3>删除影响范围</h3>
        <p>删除后无法从平台恢复，请确认以下范围。</p>
        {versions.length > 0 && (
          <div>
            <strong>产品版本</strong>
            <ul>
              {versions.map((version) => (
                <li key={version.id}>
                  {version.version}
                  {version.name ? ` · ${version.name}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="impact-list">
          {assetLabels.map(([key, label]) => (
            <li key={key}>
              {label}：{counts[key]}
            </li>
          ))}
        </ul>
        <p>
          <strong>受影响资产合计：{total}</strong>
        </p>
        <div className="workspace-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy
              ? "正在删除…"
              : target === "project"
                ? "确认删除项目"
                : "确认删除产品版本"}
          </button>
        </div>
      </section>
    </div>
  );
}
