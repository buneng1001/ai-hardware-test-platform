import { useState } from "react";

import { V020TestGroupCard } from "./V020TestGroupCard";
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

  if (versionId === null) {
    return (
      <div className="prototype-inline-note">
        请先在“版本与趋势”中打开一个产品版本，再创建测试组。
      </div>
    );
  }

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
          <div className="prototype-filter-row">
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
            <label>
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
              {groups.page.items.map((item) => (
                <V020TestGroupCard
                  busy={groups.busy}
                  item={item}
                  key={item.id}
                  onDelete={() => void groups.previewDeletion(item.id)}
                  onOpen={() => void groups.openDetail(item.id)}
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
          <button
            className="prototype-primary"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            ＋ 新建测试组
          </button>
        </>
      )}
      {groups.actionError && (
        <div className="prototype-inline-note" role="alert">
          {groups.actionError}
        </div>
      )}
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
