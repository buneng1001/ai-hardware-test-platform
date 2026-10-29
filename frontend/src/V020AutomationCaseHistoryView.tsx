import type { AutomationCaseHistory } from "./automationTestCasesApi";

const eventLabels: Record<string, string> = {
  initial_conversion: "初始规则转换",
  created: "人工新增",
  edited: "用户修改",
  regenerated: "重新生成",
  validated: "确定性校验",
  feedback_unavailable: "AI 反馈不可用",
};

function snapshotText(snapshot: Record<string, unknown>, key: string): string {
  const value = snapshot[key];
  return typeof value === "string" && value.trim() ? value : "未填写";
}

/** 冻结版转换历史：展示原始内容、各次事件快照和反馈处理状态。 */
export function V020AutomationCaseHistoryView({
  history,
}: {
  history: AutomationCaseHistory;
}) {
  return (
    <div className="prototype-automation-history">
      <p>
        原始用例：{history.source.case_number || "未知"} —{" "}
        {history.source.title || "未填写"}
      </p>
      <dl className="prototype-automation-history-source">
        <div>
          <dt>输入</dt>
          <dd>{history.source.input || "未填写"}</dd>
        </div>
        <div>
          <dt>操作步骤</dt>
          <dd>{history.source.steps || "未填写"}</dd>
        </div>
        <div>
          <dt>预期结果</dt>
          <dd>{history.source.expected_result || "未填写"}</dd>
        </div>
      </dl>
      <ol className="prototype-automation-history-events">
        {history.items.map((entry) => (
          <li key={entry.id}>
            <strong>{eventLabels[entry.event_type] ?? entry.event_type}</strong>
            <span>{entry.created_at.slice(0, 16).replace("T", " ")}</span>
            <p>{snapshotText(entry.snapshot, "title")}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
