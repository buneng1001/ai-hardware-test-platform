import { Status } from "./V020PrototypeShared";
import type { TestGroupSummary } from "./testGroupsApi";

/** 冻结版测试组卡片：隐藏状态、范围数量和详情/删除入口。 */
export function V020TestGroupCard({
  item,
  busy,
  onOpen,
  onDelete,
}: {
  item: TestGroupSummary;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="prototype-card">
      <Status tone={item.hidden ? "normal" : "good"}>
        {item.hidden ? "已隐藏" : "显示中"}
      </Status>
      <h3>{item.name}</h3>
      <p>{item.description || "暂无说明"}</p>
      <p className="prototype-muted">
        {item.source_test_case_count} 条原始用例 ·{" "}
        {item.automation_test_case_count} 条自动化用例 ·{" "}
        {item.data_package_assignment_count} 个数据包关联
      </p>
      <div className="prototype-actions">
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onOpen}
          type="button"
        >
          编辑设置
        </button>
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onDelete}
          type="button"
        >
          删除
        </button>
      </div>
    </div>
  );
}
