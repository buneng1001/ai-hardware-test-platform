import type { DataPackage } from "./dataPackagesApi";

export function DataPackageDetail({ item }: { item: DataPackage }) {
  return (
    <section
      className="data-package-detail"
      aria-label={`${item.package_number} 数据包详情`}
    >
      <h4>{item.package_number} 数据包详情</h4>
      <p>{item.validation_message}</p>
      <p>通道：{item.channels.join("、") || "无"}</p>
      <p>生成时间：{new Date(item.generated_at).toLocaleString("zh-CN")}</p>
      <p>
        原始时间戳：
        {String(item.timestamps.first_raw_device_timestamp_ns ?? "未提供")}
      </p>
      <p>
        完整性：已检查 {item.integrity.checked_file_count} 个文件，状态{" "}
        {item.integrity.status}
      </p>
      <ul>
        {item.files.map((file) => (
          <li key={`${file.kind}-${file.path}`}>
            {file.kind} · {file.path} · {file.size_bytes} bytes · 时间戳{" "}
            {String(file.start_raw_device_timestamp_ns ?? "未提供")}
          </li>
        ))}
      </ul>
    </section>
  );
}
