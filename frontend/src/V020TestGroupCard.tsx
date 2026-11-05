import { Status } from "./V020PrototypeShared";
import type { TestGroupSummary } from "./testGroupsApi";

/** 测试组卡片：范围数量、执行器、执行入口和编辑/删除。 */
export function V020TestGroupCard({
  item,
  busy,
  runnerName,
  runners,
  onRunnerChange,
  running,
  runMessage,
  onOpen,
  onDelete,
  onRun,
}: {
  item: TestGroupSummary;
  busy: boolean;
  /** 演示版：执行器来自本地配置，没有则提示未选择。 */
  runnerName: string | null;
  runners: Array<{ id: string; name: string }>;
  onRunnerChange: (runnerId: string) => void;
  running: boolean;
  runMessage: string | null;
  onOpen: () => void;
  onDelete: () => void;
  onRun: () => void;
}) {
  return (
    <div className="prototype-card">
      <Status tone={item.hidden ? "normal" : "good"}>
        {item.hidden ? "已隐藏" : "显示中"}
      </Status>
      <h3>{item.name}</h3>
      <p>{item.description || "暂无说明"}</p>
      <p className="prototype-muted">
        人工 {item.source_test_case_count} 条 · 自动化{" "}
        {item.automation_test_case_count} 条 · 已分配数据包{" "}
        {item.data_package_assignment_count} 条
      </p>
      <label className="prototype-runner-select">
        执行器
        <select
          aria-label={`${item.name} 执行器`}
          disabled={busy || running}
          onChange={(event) => onRunnerChange(event.target.value)}
          value={runners.find((runner) => runner.name === runnerName)?.id ?? ""}
        >
          <option value="">未选择</option>
          {runners.map((runner) => (
            <option key={runner.id} value={runner.id}>
              {runner.name}
            </option>
          ))}
        </select>
      </label>
      <div className="prototype-actions">
        <button
          className="prototype-primary"
          disabled={busy || running}
          onClick={onRun}
          type="button"
        >
          {running ? "执行中…" : "执行自动化测试"}
        </button>

        <button
          className="prototype-secondary"
          disabled={busy || running}
          onClick={onOpen}
          type="button"
        >
          编辑设置
        </button>
        <button
          className="prototype-secondary"
          disabled={busy || running}
          onClick={onDelete}
          type="button"
        >
          删除
        </button>
      </div>
      {runMessage && (
        <p className="prototype-muted" role="status">
          {runMessage}
        </p>
      )}
    </div>
  );
}
