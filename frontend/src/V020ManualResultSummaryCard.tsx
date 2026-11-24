import { V030ResultSourceCard } from "./V030ResultSourceCard";
import type { ManualTestResultBatch } from "./manualTestResultsApi";
import type { DisplayResultCounts } from "./V020ResultBreakdown";

export function V020ManualResultSummaryCard({
  batches,
  selectedBatchIds,
  onSelectBatches,
  onOpenManual,
  busy,
}: {
  batches: ManualTestResultBatch[];
  selectedBatchIds: number[];
  onSelectBatches: (ids: number[]) => void;
  onOpenManual: () => void;
  busy: boolean;
}) {
  const chosen = batches.filter((item) => selectedBatchIds.includes(item.id));
  const counts: DisplayResultCounts = {
    passed: 0,
    failed: 0,
    blocked: 0,
    not_executed: 0,
  };
  for (const batch of chosen) {
    for (const result of batch.report_input ?? batch.results)
      counts[result.status] += 1;
  }
  return (
    <V030ResultSourceCard
      title="人工测试结果"
      description={
        chosen.length
          ? `人工批次 ${chosen.map((item) => "#" + item.batch_number).join("、")} · 共 ${chosen.length} 批`
          : batches.length
            ? "本次报告不纳入人工测试结果。"
            : "当前测试组还没有人工测试批次。"
      }
      selection={
        <details className="prototype-report-source-menu v030-result-select">
          <summary>
            人工测试结果（多选）：
            {selectedBatchIds.length
              ? `已选 ${selectedBatchIds.length} 批`
              : "无（不参与本次报告）"}
          </summary>
          <div
            className="prototype-report-source-options"
            role="group"
            aria-label="最终报告人工来源"
          >
            <button
              className="prototype-secondary"
              type="button"
              disabled={busy}
              onClick={() => onSelectBatches([])}
            >
              无（不参与本次报告）
            </button>
            {batches.map((item) => (
              <label key={item.id}>
                <input
                  aria-label={`选择人工批次 #${item.batch_number}`}
                  type="checkbox"
                  disabled={busy}
                  checked={selectedBatchIds.includes(item.id)}
                  onChange={(event) =>
                    onSelectBatches(
                      event.target.checked
                        ? [...selectedBatchIds, item.id]
                        : selectedBatchIds.filter((id) => id !== item.id),
                    )
                  }
                />
                人工批次 #{item.batch_number} ·{" "}
                {item.created_at.slice(0, 16).replace("T", " ")}
              </label>
            ))}
            {selectedBatchIds
              .filter((id) => !batches.some((item) => item.id === id))
              .map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked
                    disabled={busy}
                    onChange={() =>
                      onSelectBatches(
                        selectedBatchIds.filter((value) => value !== id),
                      )
                    }
                  />{" "}
                  已失效的批次 #{id}（取消勾选移除）
                </label>
              ))}
            {!batches.length && (
              <p className="prototype-muted">暂无人工测试批次。</p>
            )}
          </div>
        </details>
      }
      counts={chosen.length ? counts : undefined}
      label="所选人工测试批次"
      action={
        <button
          className="prototype-secondary"
          type="button"
          disabled={busy}
          onClick={onOpenManual}
        >
          进入人工结果录入
        </button>
      }
      note={
        chosen.length
          ? "按所选批次的事实结果累计，未填写项按未执行处理。"
          : undefined
      }
    />
  );
}
