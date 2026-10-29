import { useState } from "react";

import { Status } from "./V020PrototypeShared";
import { V020DeletionImpactPanel } from "./V020DeletionImpactPanel";
import type { ProjectSort } from "./projectsApi";
import type { V020ProjectWorkspace } from "./useV020ProjectWorkspace";

const sortOptions: Array<{ value: ProjectSort; label: string }> = [
  { value: "updated_desc", label: "最近更新" },
  { value: "name_asc", label: "名称升序" },
  { value: "created_asc", label: "创建时间" },
];

function formatUpdated(value: string): string {
  return value ? value.slice(0, 10) : "未知";
}

/** 冻结版项目列表：真实读取项目接口，并保留加载、空、失败和重试状态。 */
export function V020ProjectsScreen({
  workspace,
  onOpen,
  onBack,
}: {
  workspace: V020ProjectWorkspace;
  onOpen: (projectId: number) => void;
  onBack: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");

  const resetForm = () => {
    setCreating(false);
    setName("");
    setProductName("");
    setDescription("");
  };

  const submitProject = async () => {
    const created = await workspace.submitProject({
      name: name.trim(),
      product_name: productName.trim(),
      description: description.trim(),
    });
    if (created) resetForm();
  };

  return (
    <div className="prototype-projects">
      <div className="prototype-projects-head">
        <div>
          <div className="prototype-kicker">PROJECTS</div>
          <h1>项目列表</h1>
          <p className="prototype-muted">
            选择一个项目进入版本、趋势和测试工作区。
          </p>
        </div>
        <button className="prototype-secondary" onClick={onBack}>
          回到首页
        </button>
      </div>

      <div className="prototype-filter-row">
        <input
          aria-label="搜索项目"
          onChange={(event) => workspace.setSearch(event.target.value)}
          placeholder="搜索项目或产品名称"
          value={workspace.search}
        />
        <select
          aria-label="项目排序"
          onChange={(event) =>
            workspace.setSort(event.target.value as ProjectSort)
          }
          value={workspace.sort}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className="prototype-secondary"
          onClick={() => void workspace.refreshProjects()}
          type="button"
        >
          查找
        </button>
      </div>

      {workspace.projectsError ? (
        <div className="prototype-inline-note" role="alert">
          项目列表加载失败：{workspace.projectsError}
          <button
            className="prototype-secondary"
            onClick={() => void workspace.refreshProjects()}
            type="button"
          >
            重试
          </button>
        </div>
      ) : workspace.projects === null ? (
        <p className="prototype-muted">正在加载项目…</p>
      ) : workspace.projects.length === 0 ? (
        <div className="prototype-card">
          <h3>还没有项目</h3>
          <p className="prototype-muted">
            创建项目后，可以在项目下建立多个产品版本并保存测试资产。
          </p>
        </div>
      ) : (
        workspace.projects.map((project) => (
          <div
            aria-label={`打开项目 ${project.name}`}
            className="prototype-project-card"
            key={project.id}
            onClick={() => onOpen(project.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(project.id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div>
              <Status tone="good">进行中</Status>
              <h2>{project.name}</h2>
              <p>
                {project.product_name || "未填写产品名称"} · 最近更新：
                {formatUpdated(project.updated_at)}
              </p>
            </div>
            <div>
              <strong>{project.product_version_count} 个产品版本</strong>
              <span>{project.description || "暂无项目说明"}</span>
              <button
                className="prototype-secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  void workspace.previewProjectDeletion(project.id);
                }}
                type="button"
              >
                删除
              </button>
            </div>
          </div>
        ))
      )}

      {workspace.actionError && (
        <div className="prototype-inline-note" role="alert">
          {workspace.actionError}
        </div>
      )}

      <V020DeletionImpactPanel workspace={workspace} />

      {creating ? (
        <form
          className="prototype-card prototype-group-create"
          onSubmit={(event) => {
            event.preventDefault();
            void submitProject();
          }}
        >
          <h3>创建项目</h3>
          <label>
            项目名称
            <input
              aria-label="项目名称"
              autoFocus
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：IRIS 头环"
              value={name}
            />
          </label>
          <label>
            产品名称
            <input
              aria-label="产品名称"
              maxLength={60}
              onChange={(event) => setProductName(event.target.value)}
              placeholder="例如：多传感器记录设备"
              value={productName}
            />
          </label>
          <label>
            项目说明
            <input
              aria-label="项目说明"
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="可选"
              value={description}
            />
          </label>
          <div className="prototype-actions">
            <button
              className="prototype-primary"
              disabled={!name.trim() || !productName.trim() || workspace.busy}
            >
              创建项目
            </button>
            <button
              className="prototype-secondary"
              onClick={resetForm}
              type="button"
            >
              取消
            </button>
          </div>
        </form>
      ) : (
        <button
          className="prototype-secondary"
          onClick={() => setCreating(true)}
          type="button"
        >
          ＋ 新建项目
        </button>
      )}
    </div>
  );
}
