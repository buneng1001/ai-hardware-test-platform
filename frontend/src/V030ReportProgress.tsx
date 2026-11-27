import type { ReportAnalysis } from "./factReportsApi";
import "./V030ReportProgress.css";
const phases: Record<string, string> = {
  preparing: "读取输入与准备批次",
  model_request: "等待模型返回当前批次",
  repair: "修复模型输出结构",
  validation: "校验当前批次",
  aggregate_validation: "汇总与最终校验",
  saving: "保存最终分析",
};
export function V030ReportProgress({
  progress,
}: {
  progress: ReportAnalysis["progress"];
}) {
  if (!progress) return null;
  const {
    status,
    phase,
    completed_batches: done,
    total_batches: total,
    saved_units,
  } = progress;
  const known = done !== null && total !== null && total > 0;
  const label =
    status === "completed"
      ? "分析已结束"
      : status === "interrupted"
        ? "运行意外中断"
        : status === "cancelled"
          ? "运行已取消"
          : status === "failed"
            ? "本次运行失败"
            : (phases[phase] ?? "准备分析");
  return (
    <div className="v030-report-progress" aria-label="真实分析进度">
      <div className="v030-report-progress-heading">
        <strong>{label}</strong>
        <span>
          {known
            ? `已完成批次 ${done} / ${total}`
            : `已保存检查点 ${saved_units} 个`}
        </span>
      </div>
      {known && (
        <progress aria-label="已完成分析批次" value={done} max={total} />
      )}
      {status !== "completed" && (
        <p className="prototype-muted">
          进度依据已保存的批次；完整校验、保存成功后才形成最终结果。
        </p>
      )}
    </div>
  );
}
