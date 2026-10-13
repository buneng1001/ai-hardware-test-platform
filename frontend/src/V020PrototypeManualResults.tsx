import { TestSteps, cases } from "./V020PrototypeShared";

export function ManualResultsPage({
  groupName,
  drafts,
  setDraft,
  onBack,
}: {
  groupName: string;
  drafts: Record<string, { result: string; note: string }>;
  setDraft: (caseId: string, field: "result" | "note", value: string) => void;
  onBack: () => void;
}) {
  const manualCases = cases.filter(
    (item) => !item.automation || item.id === "TC-REC-001",
  );

  return (
    <div className="prototype-manual-content">
      <div className="prototype-kicker">人工测试结果</div>
      <h1>逐条录入人工测试</h1>
      <p className="prototype-muted">
        测试组：{groupName}。可以先录入几条，保存后离开；下次进入仍能继续填写。
      </p>
      <div className="prototype-table-wrap">
        <table className="prototype-table prototype-manual-table">
          <thead>
            <tr>
              <th>用例编号</th>
              <th>标题</th>
              <th>测试步骤</th>
              <th>测试结果</th>
              <th>测试记录</th>
            </tr>
          </thead>
          <tbody>
            {manualCases.map((item) => (
              <tr key={item.id}>
                <td>
                  <a href="#source">{item.id}</a>
                </td>
                <td>{item.title}</td>
                <td>
                  <TestSteps steps={item.steps} />
                </td>
                <td>
                  <select
                    aria-label={`${item.id} 测试结果`}
                    value={drafts[item.id]?.result ?? ""}
                    onChange={(event) =>
                      setDraft(item.id, "result", event.target.value)
                    }
                  >
                    <option value="">未填写</option>
                    <option value="passed">通过</option>
                    <option value="failed">失败</option>
                    <option value="blocked">阻塞</option>
                  </select>
                </td>
                <td>
                  <textarea
                    aria-label={`${item.id} 测试记录`}
                    value={drafts[item.id]?.note ?? ""}
                    onChange={(event) =>
                      setDraft(item.id, "note", event.target.value)
                    }
                    placeholder="输入本条人工测试记录"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="prototype-actions">
        <button>保存当前修改</button>
        <button className="prototype-secondary" onClick={onBack}>
          返回执行与结果
        </button>
      </div>
    </div>
  );
}
