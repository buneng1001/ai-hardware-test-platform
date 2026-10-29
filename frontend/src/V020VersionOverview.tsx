import { useState } from "react";

import { Status } from "./V020PrototypeShared";
import type { ProductVersion } from "./projectsApi";
import { V020DeletionImpactPanel } from "./V020DeletionImpactPanel";
import type { V020ProjectWorkspace } from "./useV020ProjectWorkspace";

/** 版本与趋势页：项目下的产品版本管理和趋势空状态，不包含趋势图本身。 */
export function V020VersionOverview({
  workspace,
}: {
  workspace: V020ProjectWorkspace;
}) {
  const [creating, setCreating] = useState(false);
  const [versionCode, setVersionCode] = useState("");
  const [versionName, setVersionName] = useState("");
  const [versionDescription, setVersionDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const detail = workspace.detail;
  const opened = workspace.openedVersion;

  if (!detail) {
    if (workspace.detailLoading) {
      return <p className="prototype-muted">正在加载项目…</p>;
    }
    if (workspace.detailError) {
      return (
        <div className="prototype-inline-note" role="alert">
          项目打开失败：{workspace.detailError}
          <button
            className="prototype-secondary"
            onClick={() => void workspace.reloadProject()}
            type="button"
          >
            重试
          </button>
        </div>
      );
    }
    return <p className="prototype-muted">请先在项目列表中选择一个项目。</p>;
  }

  const versionLabel = opened
    ? [opened.version, opened.name].filter(Boolean).join(" ")
    : "";

  const submitVersion = async () => {
    const created = await workspace.submitVersion({
      version: versionCode.trim(),
      name: versionName.trim(),
      description: versionDescription.trim(),
    });
    if (created) {
      setCreating(false);
      setVersionCode("");
      setVersionName("");
      setVersionDescription("");
    }
  };

  const startEdit = (version: ProductVersion) => {
    setEditingId(version.id);
    setEditName(version.name);
    setEditDescription(version.description);
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    const saved = await workspace.editVersion(
      editingId,
      editName.trim(),
      editDescription.trim(),
    );
    if (saved) setEditingId(null);
  };

  return (
    <>
      <div className="prototype-kicker">项目 / {detail.name}</div>
      <h2>
        {versionLabel ? `${versionLabel} 测试工作区` : "尚未建立产品版本"}
      </h2>
      <p className="prototype-muted">
        产品版本是测试用例、测试组、记录和报告的稳定上下文，新建版本不要求填写测试范围或阶段目标。
      </p>

      <div className="prototype-actions">
        <button
          className="prototype-primary"
          onClick={() => setCreating((current) => !current)}
          type="button"
        >
          ＋ 新建产品版本
        </button>
        <button
          className="prototype-secondary"
          onClick={() => void workspace.previewProjectDeletion(detail.id)}
          type="button"
        >
          删除项目
        </button>
      </div>

      {creating && (
        <form
          className="prototype-card prototype-group-create"
          onSubmit={(event) => {
            event.preventDefault();
            void submitVersion();
          }}
        >
          <h3>新建产品版本</h3>
          <label>
            产品版本号
            <input
              aria-label="产品版本号"
              autoFocus
              maxLength={40}
              onChange={(event) => setVersionCode(event.target.value)}
              placeholder="例如：EVT1"
              value={versionCode}
            />
          </label>
          <label>
            版本名称
            <input
              aria-label="版本名称"
              maxLength={60}
              onChange={(event) => setVersionName(event.target.value)}
              placeholder="可选"
              value={versionName}
            />
          </label>
          <label>
            版本说明
            <input
              aria-label="版本说明"
              maxLength={200}
              onChange={(event) => setVersionDescription(event.target.value)}
              placeholder="可选"
              value={versionDescription}
            />
          </label>
          <div className="prototype-actions">
            <button
              className="prototype-primary"
              disabled={!versionCode.trim() || workspace.busy}
            >
              创建版本
            </button>
            <button
              className="prototype-secondary"
              onClick={() => setCreating(false)}
              type="button"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="prototype-group-list">
        {detail.product_versions.length === 0 ? (
          <div className="prototype-card">
            <h3>还没有产品版本</h3>
            <p className="prototype-muted">
              新建产品版本后，才能在该版本下建立测试组和执行测试。
            </p>
          </div>
        ) : (
          detail.product_versions.map((version) => (
            <div className="prototype-card" key={version.id}>
              {editingId === version.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveEdit();
                  }}
                >
                  <h3>编辑产品版本 {version.version}</h3>
                  <label>
                    版本名称
                    <input
                      aria-label={`版本名称 ${version.version}`}
                      maxLength={60}
                      onChange={(event) => setEditName(event.target.value)}
                      value={editName}
                    />
                  </label>
                  <label>
                    版本说明
                    <input
                      aria-label={`版本说明 ${version.version}`}
                      maxLength={200}
                      onChange={(event) =>
                        setEditDescription(event.target.value)
                      }
                      value={editDescription}
                    />
                  </label>
                  <div className="prototype-actions">
                    <button
                      className="prototype-primary"
                      disabled={workspace.busy}
                    >
                      保存版本
                    </button>
                    <button
                      className="prototype-secondary"
                      onClick={() => setEditingId(null)}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="prototype-group-head">
                    <div>
                      <strong>
                        {version.version}
                        {version.name ? ` · ${version.name}` : ""}
                      </strong>
                      <p className="prototype-muted">
                        {version.description || "未填写版本说明"}
                      </p>
                    </div>
                    <Status
                      tone={opened?.id === version.id ? "good" : "normal"}
                    >
                      {opened?.id === version.id ? "当前版本" : "未打开"}
                    </Status>
                  </div>
                  <div className="prototype-actions">
                    <button
                      onClick={() => workspace.setOpenedVersion(version)}
                      type="button"
                    >
                      打开版本
                    </button>
                    <button
                      className="prototype-secondary"
                      onClick={() => startEdit(version)}
                      type="button"
                    >
                      编辑版本
                    </button>
                    <button
                      className="prototype-secondary"
                      onClick={() =>
                        void workspace.previewVersionDeletion(version)
                      }
                      type="button"
                    >
                      删除版本
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {workspace.actionError && (
        <div className="prototype-inline-note" role="alert">
          {workspace.actionError}
        </div>
      )}

      <V020DeletionImpactPanel workspace={workspace} />

      <h3>版本趋势</h3>
      {workspace.trendError ? (
        <div className="prototype-inline-note" role="alert">
          趋势数据加载失败：{workspace.trendError}
          <button
            className="prototype-secondary"
            onClick={() => void workspace.retryTrend()}
            type="button"
          >
            重试
          </button>
        </div>
      ) : !workspace.trend ? (
        <p className="prototype-muted">正在加载趋势数据…</p>
      ) : workspace.trend.status === "empty" ? (
        <div className="prototype-card">
          <h3>尚无最终报告，暂无趋势数据</h3>
          <p className="prototype-muted">
            趋势只统计已生成的最终报告。完成一次执行并生成报告后，这里会按版本、模块、测试组和用例展示结果变化。
          </p>
        </div>
      ) : (
        <div className="prototype-card">
          <h3>已有 {workspace.trend.points.length} 份最终报告</h3>
          <p className="prototype-muted">
            {workspace.trend.message ||
              "可以按版本、模块、测试组和用例查看结果变化。"}
          </p>
        </div>
      )}
    </>
  );
}
