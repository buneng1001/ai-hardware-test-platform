import { useState } from "react";

import { V020TestGroupCard } from "./V020TestGroupCard";

import {
  V020ExecuteFlowDialog,
  V020FlowNoticeDialog,
  type ExecuteFlowGroup,
} from "./V020ExecuteFlowDialog";
import { V020RunnerDialog } from "./V020RunnerDialog";
import {
  linkGroupRunner,
  readGroupRunnerLinks,
  readRunners,
} from "./mockRunners";
import { V020TestGroupCreateForm } from "./V020TestGroupCreateForm";
import { V020TestGroupDeletionDialog } from "./V020TestGroupDeletionDialog";
import { V020TestGroupDetail } from "./V020TestGroupDetail";
import { useV020TestGroups } from "./useV020TestGroups";
import "./V020TestGroups.css";

/**
 * 冻结版“测试组设置”页：真实测试组列表、创建、详情、隐藏和删除影响。
 */
export function V020TestGroupsScreen({
  versionId,
}: {
  versionId: number | null;
}) {
  const groups = useV020TestGroups(versionId);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [includeSelected, setIncludeSelected] = useState(true);
  // 演示版执行器：保存在本地，选择后挂在测试组上。
  const [runners] = useState(readRunners);
  const [runnerLinks, setRunnerLinks] = useState(readGroupRunnerLinks);
  const [runnerFilter, setRunnerFilter] = useState("");
  const [showRunnerDialog, setShowRunnerDialog] = useState(false);
  const [runMessages, setRunMessages] = useState<Record<number, string>>({});
  const [flowGroup, setFlowGroup] = useState<ExecuteFlowGroup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const runnerNameOf = (groupId: number) => {
    const runnerId = runnerLinks[String(groupId)];
    return runners.find((item) => item.id === runnerId)?.name ?? null;
  };

  /** 列表页执行入口：没有执行器先弹窗，有则打开“生成→审核→执行”演示流程。 */
  const runGroup = (item: {
    id: number;
    name: string;
    automation_test_case_count: number;
    data_package_assignment_count: number;
  }) => {
    if (!runnerNameOf(item.id)) {
      setSetupError(
        "这个测试组还没有选择执行器。请先在“执行器管理”里创建并测试连接，再回来选择执行器。",
      );
      return;
    }
    setFlowGroup({
      id: item.id,
      name: item.name,
      automationCount: item.automation_test_case_count,
      packageCount: item.data_package_assignment_count,
    });
  };
  const resetCreate = () => {
    setShowCreate(false);
    setName("");
    setDescription("");
    setIncludeSelected(true);
  };

  const submitCreate = async () => {
    const created = await groups.createGroup(
      name.trim(),
      description.trim(),
      includeSelected,
    );
    if (created) resetCreate();
  };

  if (groups.detail) {
    return (
      <>
        <div className="prototype-kicker">第 3 步 / 测试范围</div>
        <h2>测试组设置</h2>
        {groups.message && (
          <p className="prototype-muted" role="status">
            {groups.message}
          </p>
        )}
        {groups.actionError && (
          <div className="prototype-inline-note" role="alert">
            {groups.actionError}
          </div>
        )}
        <V020TestGroupDetail
          busy={groups.busy}
          detail={groups.detail}
          onApply={groups.applyDetail}
          onBack={groups.closeDetail}
          onDelete={() => void groups.previewDeletion(groups.detail!.id)}
          onExecuteFlow={() =>
            groups.detail &&
            runGroup({
              id: groups.detail.id,
              name: groups.detail.name,
              automation_test_case_count:
                groups.detail.automation_test_case_count,
              data_package_assignment_count:
                groups.detail.data_package_assignment_count,
            })
          }
          onSaveDescription={(value) => void groups.saveDescription(value)}
          onToggleHidden={() => void groups.toggleHidden()}
        />
        {groups.impact && (
          <V020TestGroupDeletionDialog
            busy={groups.busy}
            impact={groups.impact}
            onCancel={groups.cancelDeletion}
            onConfirm={() => void groups.confirmDeletion()}
          />
        )}
        <V020ExecuteFlowDialog
          group={flowGroup}
          onClose={() => setFlowGroup(null)}
          onFinished={(message) => {
            if (!flowGroup) return;
            setRunMessages((current) => ({
              ...current,
              [flowGroup.id]: message,
            }));
          }}
          runnerName={flowGroup ? runnerNameOf(flowGroup.id) : null}
        />
        <V020FlowNoticeDialog
          message={setupError}
          onClose={() => setSetupError(null)}
        />
      </>
    );
  }

  return (
    <>
      <div className="prototype-kicker">第 3 步 / 测试范围</div>
      <h2>测试组设置</h2>
      <p className="prototype-muted">
        一个产品版本可以建立多个测试组，分别配置人工与自动化用例、测试范围和数据。
      </p>
      <div className="prototype-actions">
        <button
          className="prototype-primary"
          onClick={() => setShowCreate(true)}
          type="button"
        >
          ＋ 新建测试组
        </button>
        <button
          className="prototype-secondary"
          onClick={() => setShowRunnerDialog(true)}
          type="button"
        >
          执行器管理
        </button>
      </div>
      {groups.message && (
        <p className="prototype-muted" role="status">
          {groups.message}
        </p>
      )}
      {showCreate ? (
        <V020TestGroupCreateForm
          busy={groups.busy}
          description={description}
          includeSelected={includeSelected}
          name={name}
          onCancel={resetCreate}
          onDescriptionChange={setDescription}
          onIncludeSelectedChange={setIncludeSelected}
          onNameChange={setName}
          onSubmit={() => void submitCreate()}
        />
      ) : (
        <>
          <div className="prototype-filter-row prototype-test-group-filters">
            <input
              aria-label="搜索测试组"
              onChange={(event) => groups.setSearch(event.target.value)}
              placeholder="搜索测试组名称"
              value={groups.search}
            />
            <select
              aria-label="测试组排序"
              onChange={(event) => groups.setSort(event.target.value)}
              value={groups.sort}
            >
              <option value="updated_desc">最近更新</option>
              <option value="name_asc">名称升序</option>
              <option value="name_desc">名称降序</option>
            </select>
            <select
              aria-label="执行器筛选"
              onChange={(event) => setRunnerFilter(event.target.value)}
              value={runnerFilter}
            >
              <option value="">全部执行器</option>
              {runners.map((runner) => (
                <option key={runner.id} value={runner.id}>
                  {runner.name}
                </option>
              ))}
            </select>
            <label className="prototype-inline-check">
              <input
                aria-label="显示已隐藏测试组"
                checked={groups.showHidden}
                onChange={(event) => groups.setShowHidden(event.target.checked)}
                type="checkbox"
              />
              显示已隐藏测试组
            </label>
          </div>
          {groups.status === "error" && (
            <div className="prototype-inline-note" role="alert">
              测试组加载失败：{groups.error}
              <button
                className="prototype-secondary"
                onClick={groups.retry}
                type="button"
              >
                重试
              </button>
            </div>
          )}
          {groups.status === "loading" && groups.page === null && (
            <p className="prototype-muted" role="status">
              正在加载测试组…
            </p>
          )}
          {groups.status === "ready" && groups.page?.items.length === 0 && (
            <div className="prototype-card">
              <h3>尚无符合条件的测试组</h3>
              <p className="prototype-muted">
                创建测试组后可在详情中维护用例范围和数据包关联。
              </p>
            </div>
          )}
          {groups.page && groups.page.items.length > 0 && (
            <div className="prototype-group-list">
              {groups.page.items
                .filter(
                  (item) =>
                    runnerFilter === "" ||
                    runnerLinks[String(item.id)] === runnerFilter,
                )
                .map((item) => (
                  <V020TestGroupCard
                    busy={groups.busy}
                    item={item}
                    key={item.id}

                    onDelete={() => void groups.previewDeletion(item.id)}
                    onOpen={() => void groups.openDetail(item.id)}
                    onRun={() => runGroup(item)}
                    running={flowGroup?.id === item.id}
                    onRunnerChange={(runnerId) => {
                      linkGroupRunner(item.id, runnerId);
                      setRunnerLinks(readGroupRunnerLinks());
                    }}
                    runMessage={runMessages[item.id] ?? null}
                    runnerName={runnerNameOf(item.id)}
                    runners={runners}
                  />
                ))}
            </div>
          )}
          {groups.page && groups.page.total > groups.page.page_size && (
            <div className="prototype-actions">
              <button
                className="prototype-secondary"
                disabled={groups.page.page <= 1}
                onClick={() =>
                  groups.setCurrentPage((current) => Math.max(1, current - 1))
                }
                type="button"
              >
                上一页
              </button>
              <span className="prototype-muted">
                第 {groups.page.page} 页 / 共 {groups.page.total} 个
              </span>
              <button
                className="prototype-secondary"
                disabled={
                  groups.page.page * groups.page.page_size >= groups.page.total
                }
                onClick={() => groups.setCurrentPage((current) => current + 1)}
                type="button"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
      {groups.actionError && (
        <div className="prototype-inline-note" role="alert">
          {groups.actionError}
        </div>
      )}
      <V020RunnerDialog
        onClose={() => setShowRunnerDialog(false)}
        open={showRunnerDialog}
      />
      <V020ExecuteFlowDialog
        group={flowGroup}
        onClose={() => setFlowGroup(null)}
        onFinished={(message) => {
          if (!flowGroup) return;
          setRunMessages((current) => ({
            ...current,
            [flowGroup.id]: message,
          }));
        }}
        runnerName={flowGroup ? runnerNameOf(flowGroup.id) : null}
      />
      <V020FlowNoticeDialog
        message={setupError}
        onClose={() => setSetupError(null)}
      />
      {groups.impact && (
        <V020TestGroupDeletionDialog
          busy={groups.busy}
          impact={groups.impact}
          onCancel={groups.cancelDeletion}
          onConfirm={() => void groups.confirmDeletion()}
        />
      )}
    </>
  );
}
