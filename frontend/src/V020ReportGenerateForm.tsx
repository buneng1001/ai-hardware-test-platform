import { useState } from "react";

import { V020ConfirmDialog } from "./V020ConfirmDialog";
import type { AutomationExecution } from "./automationExecutionsApi";
import type { ManualTestResultBatch } from "./manualTestResultsApi";

/** 报告生成选择：两种记录都用下拉框，默认选最新一条，确认后再生成。 */
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
  // 按 id 倒序即“最新在前”，默认直接选中最新一条。
  const latestExecutions = [...executions].sort((a, b) => b.id - a.id);
  const latestBatches = [...batches].sort((a, b) => b.id - a.id);
  const [executionId, setExecutionId] = useState(
    latestExecutions[0] ? String(latestExecutions[0].id) : "",
  );
  const [batchId, setBatchId] = useState(
    latestBatches[0] ? String(latestBatches[0].id) : "",
  );
  const [confirming, setConfirming] = useState(false);
  const nothingSelected = executionId === "" && batchId === "";

  const chosenExecution = latestExecutions.find(
    (item) => String(item.id) === executionId,
  );
  const chosenBatch = latestBatches.find((item) => String(item.id) === batchId);

  return (
    <div className="prototype-card prototype-report-generate">
      <h3>生成最终报告</h3>
      <p className="prototype-muted">
        默认使用最新一条自动化执行记录和最新一批人工记录；只选其中一类也可以生成。
        记录必须属于当前测试组和产品版本。
      </p>
      {latestExecutions.length === 0 && latestBatches.length === 0 && (
        <p className="prototype-inline-note">
          暂无可选记录，请先执行自动化测试或保存人工结果。
        </p>
      )}
      <div className="prototype-filter-row">
        <label>
          自动化执行记录
          <select
            aria-label="自动化执行记录"
            disabled={busy}
            onChange={(event) => setExecutionId(event.target.value)}
            value={executionId}
          >
            <option value="">不使用自动化记录</option>
            {latestExecutions.map((item) => (
              <option key={item.id} value={item.id}>
                自动化执行 #{item.execution_number}（
                {item.status === "completed" ? "已完成" : item.status}）
              </option>
            ))}
          </select>
        </label>
        <label>
          人工测试记录
          <select
            aria-label="人工测试记录"
            disabled={busy}
            onChange={(event) => setBatchId(event.target.value)}
            value={batchId}
          >
            <option value="">不使用人工记录</option>
            {latestBatches.map((item) => (
              <option key={item.id} value={item.id}>
                批次 #{item.batch_number}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="prototype-actions">
        <button
          className="prototype-primary"
          disabled={busy || nothingSelected}
          onClick={() => setConfirming(true)}
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

      {confirming && (
        <V020ConfirmDialog
          ariaLabel="确认生成最终报告"
          busy={busy}
          confirmLabel="确认生成"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void onGenerate(
              executionId === "" ? null : Number(executionId),
              batchId === "" ? [] : [Number(batchId)],
            );
          }}
          title="确认生成最终报告"
        >
          <ul>
            <li>
              自动化执行记录：
              {chosenExecution
                ? `#${chosenExecution.execution_number}`
                : "不使用"}
            </li>
            <li>
              人工测试记录：
              {chosenBatch ? `批次 #${chosenBatch.batch_number}` : "不使用"}
            </li>
          </ul>
        </V020ConfirmDialog>
      )}
    </div>
  );
}
