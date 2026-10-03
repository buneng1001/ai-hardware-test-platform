import { useEffect, useState } from "react";

import { TestGroupCasesPanel } from "./TestGroupCasesPanel";
import {
  deleteTestGroup,
  getTestGroupDeletionImpact,
  setTestGroupHidden,
  updateTestGroup,
  type TestGroupDetail,
} from "./testGroupsApi";

export function TestGroupDetailPanel({
  detail,
  onChange,
  onDeleted,
}: {
  detail: TestGroupDetail;
  onChange: (detail: TestGroupDetail) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState({
    name: detail.name,
    description: detail.description,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(
    () => setDraft({ name: detail.name, description: detail.description }),
    [detail.id, detail.name, detail.description],
  );

  const run = async (
    action: () => Promise<TestGroupDetail | void>,
    success: string,
  ) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (result) onChange(result);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试组操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="test-group-detail"
      aria-label={`${detail.name} 测试组详情`}
    >
      <div className="test-group-heading">
        <div>
          <h3>{detail.name}</h3>
          <p>
            范围变更不会删除平台级用例或数据包。数据包只有已校验通过才可关联。
          </p>
        </div>
        <div className="workspace-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () => setTestGroupHidden(detail.id, !detail.hidden),
                detail.hidden ? "已恢复显示。" : "已隐藏。",
              )
            }
          >
            {detail.hidden ? "恢复显示" : "隐藏"}
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const impact = await getTestGroupDeletionImpact(detail.id);
                if (
                  !window.confirm(
                    `将移除 ${impact.source_test_cases} 条原始用例、${impact.automation_test_cases} 条自动化用例和 ${impact.data_package_assignments} 条数据包关联。`,
                  )
                )
                  return;
                await deleteTestGroup(detail.id);
                onDeleted();
              }, "测试组已删除。")
            }
          >
            删除
          </button>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      <form
        className="test-group-edit"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => updateTestGroup(detail.id, draft), "基本信息已保存。");
        }}
      >
        <label>
          名称
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </label>
        <label>
          说明
          <textarea
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </label>
        <button type="submit" disabled={busy}>
          保存基本信息
        </button>
      </form>
      <TestGroupCasesPanel detail={detail} onChange={onChange} />
    </section>
  );
}
