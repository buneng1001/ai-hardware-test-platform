import { useEffect, useState } from "react";

import { Status } from "./V020PrototypeShared";
import { V020TestGroupAutomationCases } from "./V020TestGroupAutomationCases";
import { V020TestGroupSourceCases } from "./V020TestGroupSourceCases";
import type { TestGroupDetail } from "./testGroupsApi";

/** 冻结版测试组详情：基本信息、范围、数据包和删除入口。 */
export function V020TestGroupDetail({
  detail,
  busy,
  onApply,
  onSaveDescription,
  onToggleHidden,
  onDelete,
  onBack,
}: {
  detail: TestGroupDetail;
  busy: boolean;
  onApply: (detail: TestGroupDetail) => void;
  onSaveDescription: (description: string) => void;
  onToggleHidden: () => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [description, setDescription] = useState(detail.description);

  useEffect(() => setDescription(detail.description), [detail.description]);

  return (
    <section aria-label={`${detail.name} 测试组详情`}>
      <div className="prototype-group-head">
        <div>
          <strong>{detail.name}</strong>
          <p>
            原始 {detail.source_test_case_count} 条 · 自动化{" "}
            {detail.automation_test_case_count} 条 · 数据包关联{" "}
            {detail.data_package_assignment_count} 条
          </p>
          <small className="prototype-muted">测试组名称创建后不可修改</small>
        </div>
        <Status tone={detail.hidden ? "normal" : "good"}>
          {detail.hidden ? "已隐藏" : "显示中"}
        </Status>
      </div>
      <div className="prototype-actions">
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onToggleHidden}
          type="button"
        >
          {detail.hidden ? "恢复显示" : "隐藏"}
        </button>
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onDelete}
          type="button"
        >
          删除测试组
        </button>
        <button className="prototype-secondary" onClick={onBack} type="button">
          返回设置列表
        </button>
      </div>
      <form
        className="prototype-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSaveDescription(description);
        }}
      >
        <label>
          测试组说明
          <textarea
            aria-label="测试组说明"
            disabled={busy}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="prototype-actions">
          <button className="prototype-secondary" disabled={busy}>
            保存说明
          </button>
        </div>
      </form>
      <V020TestGroupSourceCases detail={detail} onChange={onApply} />
      <V020TestGroupAutomationCases detail={detail} onChange={onApply} />
    </section>
  );
}
