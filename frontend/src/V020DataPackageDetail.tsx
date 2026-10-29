import { Status } from "./V020PrototypeShared";
import type { DataPackage } from "./dataPackagesApi";
import {
  formatGeneratedAt,
  packageKindLabel,
  sourceLabel,
} from "./v020DataPackageLabels";

/** 冻结版数据包详情：文件、通道、时间戳、完整性和正常/故障属性。 */
export function V020DataPackageDetail({
  item,
  onClose,
}: {
  item: DataPackage;
  onClose: () => void;
}) {
  const firstTimestamp = item.timestamps.first_raw_device_timestamp_ns;
  return (
    <section
      className="prototype-card prototype-data-detail"
      aria-label={`${item.package_number} 数据包详情`}
    >
      <div className="prototype-data-detail-head">
        <div>
          <h3>
            {item.package_number} 数据包详情{" "}
            <Status
              tone={item.validation_status === "passed" ? "good" : "warn"}
            >
              {item.validation_status === "passed"
                ? "完整性通过"
                : "完整性失败"}
            </Status>
          </h3>
          <p className="prototype-muted">{item.validation_message}</p>
        </div>
        <button className="prototype-secondary" onClick={onClose} type="button">
          关闭详情
        </button>
      </div>
      <dl className="prototype-data-detail-grid">
        <div>
          <dt>来源任务</dt>
          <dd>
            {item.source_task_name}（运行 #{item.source_run_execution_number}）
          </dd>
        </div>
        <div>
          <dt>来源与属性</dt>
          <dd>
            {sourceLabel(item.source_type)} · {packageKindLabel(item)}
          </dd>
        </div>
        <div>
          <dt>版本指纹</dt>
          <dd>{item.version_fingerprint}</dd>
        </div>
        <div>
          <dt>生成时间</dt>
          <dd>{formatGeneratedAt(item.generated_at)}</dd>
        </div>
        <div>
          <dt>通道</dt>
          <dd>{item.channels.join("、") || "无"}</dd>
        </div>
        <div>
          <dt>首个原始时间戳</dt>
          <dd>
            {firstTimestamp === null || firstTimestamp === undefined
              ? "未提供"
              : String(firstTimestamp)}
          </dd>
        </div>
        <div>
          <dt>完整性</dt>
          <dd>
            {item.integrity.status === "passed" ? "通过" : "未通过"} · 已检查{" "}
            {item.integrity.checked_file_count} 个文件
          </dd>
        </div>
        <div>
          <dt>文件异常</dt>
          <dd>
            缺失 {item.integrity.missing_files.length} 个；大小不符{" "}
            {item.integrity.size_mismatches.length} 个
          </dd>
        </div>
        <div>
          <dt>可用于测试组</dt>
          <dd>{item.eligible_for_test_group ? "是" : "否"}</dd>
        </div>
      </dl>
      <div className="prototype-table-wrap">
        <table className="prototype-table prototype-data-file-table">
          <thead>
            <tr>
              <th>文件类型</th>
              <th>路径</th>
              <th>大小</th>
              <th>编码</th>
              <th>起始原始时间戳</th>
              <th>哈希</th>
            </tr>
          </thead>
          <tbody>
            {item.files.map((file) => (
              <tr key={`${file.kind}-${file.path}`}>
                <td>{file.kind}</td>
                <td>{file.path}</td>
                <td>{file.size_bytes} bytes</td>
                <td>{file.codec ?? "无"}</td>
                <td>
                  {file.start_raw_device_timestamp_ns === null
                    ? "未提供"
                    : String(file.start_raw_device_timestamp_ns)}
                </td>
                <td>{file.sha256.slice(0, 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
