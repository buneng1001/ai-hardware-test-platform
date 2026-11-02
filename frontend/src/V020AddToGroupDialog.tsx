import { useEffect, useState } from "react";

import "./V020DeletionImpactPanel.css";

import {
  addTestGroupAutomationCases,
  addTestGroupSourceCases,
  createTestGroup,
  listTestGroups,
  type TestGroupSummary,
} from "./testGroupsApi";

/**
 * “加入测试组”弹窗：在用例表原地选择已有测试组或新建，
 * 加入完成后停留在当前页面，不再跳到测试组设置。
 */
export function V020AddToGroupDialog({
  open,
  versionId,
  sourceIds,
  automationIds,
  onClose,
  onDone,
}: {
  open: boolean;
  versionId: number | null;
  sourceIds: number[];
  automationIds: number[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [groups, setGroups] = useState<TestGroupSummary[]>([]);
  const [groupId, setGroupId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || versionId === null) return;
    void listTestGroups(versionId)
      .then((page) => {
        setGroups(page.items);
        setGroupId(page.items[0] ? String(page.items[0].id) : "");
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "测试组加载失败"),
      );
  }, [open, versionId]);

  if (!open) return null;

  const total = sourceIds.length + automationIds.length;

  /** 把勾选的用例真正加入测试组；两类用例分别调用各自接口。 */
  const joinTo = async (targetGroupId: number, label: string) => {
    setBusy(true);
    setError(null);
    try {
      if (sourceIds.length > 0) {
        await addTestGroupSourceCases(targetGroupId, sourceIds);
      }
      if (automationIds.length > 0) {
        await addTestGroupAutomationCases(targetGroupId, automationIds);
      }
      onDone(`已把 ${total} 条用例加入「${label}」。`);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加入测试组失败");
    } finally {
      setBusy(false);
    }
  };

  const createAndJoin = async () => {
    if (versionId === null) return;
    const name = newName.trim();
    if (!name) {
      setError("请填写测试组名称");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 原始用例用后端“带入已勾选”能力，自动化用例单独补加。
      const created = await createTestGroup(versionId, {
        name,
        description: newDescription.trim(),
        include_selected_source_cases: sourceIds.length > 0,
      });
      if (automationIds.length > 0) {
        await addTestGroupAutomationCases(created.id, automationIds);
      }
      onDone(
        `已新建测试组「${name}」并加入 ${sourceIds.length + automationIds.length} 条用例。`,
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建测试组失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prototype-modal-backdrop">
      <div
        aria-label="加入测试组"
        aria-modal="true"
        className="prototype-modal"
        role="dialog"
      >
        <h3>加入测试组</h3>
        <p className="prototype-muted">
          将加入 {sourceIds.length} 条原始用例、{automationIds.length}{" "}
          条自动化用例。
        </p>

        <label>
          已有测试组
          <select
            aria-label="选择测试组"
            disabled={busy || groups.length === 0}
            onChange={(event) => setGroupId(event.target.value)}
            value={groupId}
          >
            {groups.length === 0 && <option value="">还没有测试组</option>}
            {groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="prototype-actions">
          <button
            className="prototype-primary"
            disabled={busy || !groupId}
            onClick={() => {
              const target = groups.find((item) => String(item.id) === groupId);
              void joinTo(Number(groupId), target?.name ?? "所选测试组");
            }}
            type="button"
          >
            加入所选测试组
          </button>
        </div>

        <hr />
        <label>
          或者新建测试组
          <input
            aria-label="新测试组名称"
            disabled={busy}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="例如：EVT1 基础回归"
            value={newName}
          />
        </label>
        <label>
          描述或备注（可选）
          <input
            aria-label="新测试组描述"
            disabled={busy}
            onChange={(event) => setNewDescription(event.target.value)}
            placeholder="例如：EVT1 阶段的断电恢复专项"
            value={newDescription}
          />
        </label>
        <div className="prototype-actions">
          <button
            className="prototype-secondary"
            disabled={busy || newName.trim() === ""}
            onClick={() => void createAndJoin()}
            type="button"
          >
            新建并加入
          </button>
          <button
            className="prototype-secondary"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
        </div>

        {error && (
          <p
            className="prototype-ai-feedback prototype-ai-feedback-error"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
