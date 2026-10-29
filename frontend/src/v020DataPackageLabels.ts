import type { DataPackage, DataPackageSource } from "./dataPackagesApi";

export const faultTypeLabels: Record<string, string> = {
  video_drop: "视频掉帧",
  imu_anomaly: "IMU 异常",
  storage_exhaustion: "存储不足",
  temperature_combination: "温度组合",
  fixed_offset: "固定偏移",
  linear_drift: "线性漂移",
};

export function sourceLabel(source: DataPackageSource): string {
  return source === "generated" ? "平台生成" : "用户导入";
}

export function packageKindLabel(item: DataPackage): string {
  if (item.data_kind === "normal") return "正常数据";
  const fault = item.fault_type ? faultTypeLabels[item.fault_type] : "未知故障";
  return `故障数据：${fault ?? item.fault_type}`;
}

export function formatGeneratedAt(value: string): string {
  return value ? value.slice(0, 16).replace("T", " ") : "未知时间";
}
