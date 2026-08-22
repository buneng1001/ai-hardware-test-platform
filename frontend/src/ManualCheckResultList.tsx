import {
  type ManualCheckResult,
  manualCheckStatusLabels,
} from "./manualCheckResultsApi";

type Props = {
  runId: number;
  results: ManualCheckResult[];
  onEdit: (result: ManualCheckResult) => void;
};

export function ManualCheckResultList({ runId, results, onEdit }: Props) {
  if (results.length === 0) {
    return <p>暂无人工检查结果。</p>;
  }

  return (
    <ul>
      {results.map((result) => (
        <li key={result.id}>
          <strong>{result.name}</strong>
          <span>
            {manualCheckStatusLabels[result.status]} ·{" "}
            {result.actual_result || "未填写实际结果"}
          </span>
          {result.notes && <span>备注：{result.notes}</span>}
          {result.executed_at && (
            <time dateTime={result.executed_at}>
              执行时间：{result.executed_at}
            </time>
          )}
          {result.attachment && (
            <a
              href={`/api/runs/${runId}/manual-check-results/${result.id}/attachment`}
            >
              附件：{result.attachment.filename}（{result.attachment.size_bytes}{" "}
              字节）
            </a>
          )}
          <button
            type="button"
            aria-label={`修改${result.name}`}
            onClick={() => onEdit(result)}
          >
            修改
          </button>
        </li>
      ))}
    </ul>
  );
}
