import { Status } from "./V020PrototypeShared";
import type { DataPackage } from "./dataPackagesApi";
import {
  formatGeneratedAt,
  packageKindLabel,
  sourceLabel,
} from "./v020DataPackageLabels";

/** 冻结版数据包卡片：真实来源、属性、指纹和输入源更新提示。 */
export function V020DataPackageCard({
  item,
  busy,
  onDetail,
  onDelete,
}: {
  item: DataPackage;
  busy: boolean;
  onDetail: () => void;
  onDelete: () => void;
}) {
  const copyNumber = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard
      .writeText(item.package_number)
      .catch(() => undefined);
  };

  return (
    <div className="prototype-card prototype-data-card">
      <div className="prototype-data-title">
        <Status tone={item.eligible_for_test_group ? "good" : "warn"}>
          {item.eligible_for_test_group ? "已校验" : "未通过校验"}
        </Status>
        <h3>{item.package_number}</h3>
        <button
          className="prototype-copy-button"
          type="button"
          title="复制编号"
          aria-label={`复制数据编号 ${item.package_number}`}
          onClick={copyNumber}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
            <path d="M8 8h11v11H8z" />
            <path d="M5 16H3V3h13v2" />
          </svg>
        </button>
      </div>
      <p>
        <strong>{item.source_task_name}</strong> ·{" "}
        {sourceLabel(item.source_type)}
      </p>
      <p>
        {packageKindLabel(item)} · 来源运行 #{item.source_run_execution_number}
      </p>
      <p className="prototype-muted">
        指纹 {item.version_fingerprint.slice(0, 12)} · 生成于{" "}
        {formatGeneratedAt(item.generated_at)}
      </p>
      {item.has_newer_source_result && (
        <p className="prototype-data-update" role="status">
          {`输入源已有更新：推荐运行 #${
            item.recommended_source_run_id ?? "未知"
          }；不会自动替换当前包，旧数据包仍可用于复现。`}
        </p>
      )}
      <div className="prototype-actions">
        <button disabled={busy} onClick={onDetail} type="button">
          查看数据详情
        </button>
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onDelete}
          type="button"
        >
          删除数据包
        </button>
      </div>
    </div>
  );
}
