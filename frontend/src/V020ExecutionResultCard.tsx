import { V030ResultSourceCard } from "./V030ResultSourceCard";
import type { AutomationExecution } from "./automationExecutionsApi";

const statusLabels: Record<string, string> = {
  completed: "已完成",
  cancelled: "已取消",
  interrupted: "已中断",
};

export function V020ExecutionResultCard({
  records,
  selectedExecutionId,
  onSelectExecution,
  onRefresh,
  busy,
}: {
  records: AutomationExecution[];
  selectedExecutionId: number | null;
  onSelectExecution: (id: number | null) => void;
  onRefresh: () => void;
  busy: boolean;
}) {
  const selected = records.find((item) => item.id === selectedExecutionId);
  return (
    <V030ResultSourceCard
      title="自动化执行结果"
      description={
        selected
          ? `执行时间：${selected.started_at.slice(0, 16).replace("T", " ")} · ${statusLabels[selected.status] ?? selected.status}`
          : records.length
            ? "本次报告不纳入自动化执行结果。"
            : "当前测试组还没有自动化执行记录。"
      }
      selection={
        <select
          aria-label="最终报告自动化来源"
          disabled={busy}
          value={selectedExecutionId ?? "none"}
          onChange={(event) =>
            onSelectExecution(
              event.target.value === "none" ? null : Number(event.target.value),
            )
          }
        >
          <option value="none">无（不参与本次报告）</option>
          {selectedExecutionId !== null && !selected && (
            <option value={selectedExecutionId}>
              已失效的记录 #{selectedExecutionId}
            </option>
          )}
          {records.map((item) => (
            <option key={item.id} value={item.id}>
              自动化执行 #{item.execution_number} ·{" "}
              {statusLabels[item.status] ?? item.status} ·{" "}
              {item.started_at.slice(0, 16).replace("T", " ")}
            </option>
          ))}
        </select>
      }
      counts={selected?.summary}
      label={
        selected ? `自动化执行 #${selected.execution_number}` : "自动化执行"
      }
      action={
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onRefresh}
          type="button"
        >
          刷新最新结果
        </button>
      }
      note={
        selected
          ? "数据驱动模拟，不连接真实设备；已完成不代表全部通过。"
          : undefined
      }
    />
  );
}
