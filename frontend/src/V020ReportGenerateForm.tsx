import { useState } from "react";

import type { AutomationExecution } from "./automationExecutionsApi";
import type { ManualTestResultBatch } from "./manualTestResultsApi";

/** 冻结版报告生成选择：最多一条自动化记录、多条人工批次，单类也可生成。 */
export function V020ReportGenerateForm({
  executions,
  batches,
  busy,
  onCancel,
  onGenerate,
}: {
  executions: AutomationExecution[];
  batches: ManualTestResultBatch[];
  busy: boolean;
  onCancel: () => void;
  onGenerate: (
    executionId: number | null,
    manualBatchIds: number[],
  ) => Promise<boolean>;
}) {
  const [executionId, setExecutionId] = useState("");
  const [batchIds, setBatchIds] = useState<number[]>([]);
  const nothingSelected = executionId === "" && batchIds.length === 0;

  return (
    <div className="prototype-card prototype-report-generate">
      <h3>生成最终报告</h3>
      <p className="prototype-muted">
        一次最多选择一条自动化执行记录和多条人工记录；只有其中一类也可以生成。
        记录必须属于当前测试组和产品版本。
      </p>
      {executions.length === 0 && batches.length === 0 && (
        <p className="prototype-inline-note">
          暂无可选记录，请先执行自动化测试或保存人工结果。
        </p>
      )}
      <div className="prototype-filter-row">
        <label>
          自动化执行记录（最多一条）
          <select
            aria-label="自动化执行记录"
            disabled={busy}
            onChange={(event) => setExecutionId(event.target.value)}
            value={executionId}
          >
            <option value="">不选择自动化记录</option>
            {executions.map((item) => (
              <option key={item.id} value={item.id}>
                自动化执行 #{item.execution_number}（
                {item.status === "completed" ? "已完成" : item.status}）
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="prototype-report-batches">
        <legend>人工测试记录（可多选）</legend>
        {batches.length === 0 ? (
          <p className="prototype-muted">当前测试组还没有人工记录批次。</p>
        ) : (
          batches.map((item) => (
            <label key={item.id}>
              <input
                aria-label={`选择人工批次 #${item.batch_number}`}
                checked={batchIds.includes(item.id)}
                disabled={busy}
                onChange={(event) =>
                  setBatchIds((current) =>
                    event.target.checked
                      ? [...current, item.id]
                      : current.filter((id) => id !== item.id),
                  )
                }
                type="checkbox"
              />
              批次 #{item.batch_number}
            </label>
          ))
        )}
      </fieldset>
      <div className="prototype-actions">
        <button
          className="prototype-primary"
          disabled={busy || nothingSelected}
          onClick={() =>
            void onGenerate(
              executionId === "" ? null : Number(executionId),
              batchIds,
            )
          }
          type="button"
        >
          生成事实报告
        </button>
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </div>
  );
}
