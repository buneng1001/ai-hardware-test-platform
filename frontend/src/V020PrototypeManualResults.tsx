import { V020ManualResultRow } from "./V020ManualResultRow";
import { manualTestStatusLabels } from "./manualTestResultsApi";
import { useV020ManualTestResults } from "./useV020ManualTestResults";
import "./V020ManualResults.css";

export function ManualResultsPage({
  groupId,
  groupName,
  onBack,
}: {
  groupId: number | null;
  groupName: string;
  onBack: () => void;
}) {
  const manual = useV020ManualTestResults(groupId);

  if (groupId === null) {
    return (
      <div className="prototype-manual-content">
        <div className="prototype-kicker">人工测试结果</div>
        <h1>逐条录入人工测试</h1>
        <div className="prototype-inline-note">
          请先在“执行与结果”中选择一个测试组，再录入人工结果。
        </div>
        <button className="prototype-secondary" onClick={onBack} type="button">
          返回执行与结果
        </button>
      </div>
    );
  }

  if (manual.status === "loading" || manual.status === "idle") {
    return (
      <div className="prototype-manual-content">
        <p className="prototype-muted" role="status">
          正在加载人工测试结果…
        </p>
      </div>
    );
  }

  if (manual.status === "error") {
    return (
      <div className="prototype-manual-content">
        <div className="prototype-inline-note" role="alert">
          人工测试结果加载失败：{manual.error}
          <button
            className="prototype-secondary"
            onClick={manual.retry}
            type="button"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const page = manual.page;
  const currentBatch = page?.batches.find((item) => item.id === manual.batchId);

  return (
    <div className="prototype-manual-content">
      <div className="prototype-kicker">人工测试结果</div>
      <h1>逐条录入人工测试</h1>
      <p className="prototype-muted">
        测试组：{groupName}
        。只显示人工与混合用例；可逐行或按批次保存，关闭后重新进入会恢复已保存内容。
      </p>
      {manual.message && (
        <p className="prototype-muted" role="status">
          {manual.message}
        </p>
      )}
      {manual.actionError && (
        <div className="prototype-inline-note" role="alert">
          {manual.actionError}
        </div>
      )}
      {page && page.batches.length > 0 && (
        <div className="prototype-filter-row">
          <label>
            记录批次
            <select
              aria-label="记录批次"
              disabled={manual.busy}
              onChange={(event) =>
                manual.selectBatch(Number(event.target.value))
              }
              value={manual.batchId ?? ""}
            >
              {manual.batchId === null && (
                <option value="">新记录批次（未保存）</option>
              )}
              {page.batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  批次 #{batch.batch_number}
                </option>
              ))}
            </select>
          </label>
          <button
            className="prototype-secondary"
            disabled={manual.busy}
            onClick={manual.newBatch}
            type="button"
          >
            新建记录批次
          </button>
        </div>
      )}
      {page && page.cases.length === 0 ? (
        <div className="prototype-card">
          <h3>当前测试组没有人工或混合用例</h3>
          <p className="prototype-muted">
            请在测试组的原始用例范围中加入测试类型为 manual 或 mixed 的用例。
          </p>
        </div>
      ) : (
        page && (
          <div className="prototype-table-wrap">
            <table className="prototype-table prototype-manual-table">
              <thead>
                <tr>
                  <th>用例编号</th>
                  <th>标题</th>
                  <th>类型</th>
                  <th>测试结果</th>
                  <th>实际结果</th>
                  <th>备注</th>
                  <th>执行时间</th>
                  <th>附件与操作</th>
                </tr>
              </thead>
              <tbody>
                {page.cases.map((item) => (
                  <V020ManualResultRow
                    busy={manual.busy}
                    draft={manual.drafts[item.id]}
                    item={item}
                    key={item.id}
                    saved={currentBatch?.results.find(
                      (result) => result.source_test_case_id === item.id,
                    )}
                    onDeleteAttachment={(attachmentId) =>
                      void manual.removeAttachment(attachmentId)
                    }
                    onDeleteResult={(resultId) =>
                      void manual.removeResult(resultId)
                    }
                    onDraftChange={(change) =>
                      manual.updateDraft(item.id, change)
                    }
                    onSave={() => void manual.save([item.id])}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      <p className="prototype-inline-note">
        未填写项在报告中确定性表达为“{manualTestStatusLabels.not_executed}
        ”，不会推断结果；删除人工结果会产生报告过期事件。
      </p>
      <div className="prototype-actions">
        {page && page.cases.length > 0 && (
          <button
            className="prototype-primary"
            disabled={manual.busy}
            onClick={() => void manual.save(page.cases.map((item) => item.id))}
            type="button"
          >
            保存当前批次
          </button>
        )}
        <button className="prototype-secondary" onClick={onBack} type="button">
          返回执行与结果
        </button>
      </div>
    </div>
  );
}
