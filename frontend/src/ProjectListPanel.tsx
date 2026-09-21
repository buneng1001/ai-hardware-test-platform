import { type FormEvent, useState } from "react";

import type {
  ProjectCommand,
  ProjectSort,
  ProjectSummary,
} from "./projectsApi";

type ProjectListPanelProps = {
  projects: ProjectSummary[] | null;
  busy: boolean;
  onCreate: (command: ProjectCommand) => Promise<boolean>;
  onSearch: (search: string, sort: ProjectSort) => Promise<void>;
  onOpen: (projectId: number) => void;
  onDelete: (projectId: number) => void;
};

const emptyCommand = { name: "", product_name: "", description: "" };

export function ProjectListPanel({
  projects,
  busy,
  onCreate,
  onSearch,
  onOpen,
  onDelete,
}: ProjectListPanelProps) {
  const [command, setCommand] = useState<ProjectCommand>(emptyCommand);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ProjectSort>("updated_desc");

  const submitProject = async (event: FormEvent) => {
    event.preventDefault();
    if (await onCreate(command)) setCommand(emptyCommand);
  };

  return (
    <aside className="workspace-panel">
      <form
        className="workspace-form"
        onSubmit={(event) => void submitProject(event)}
      >
        <h3>新建项目</h3>
        <label>
          项目名称
          <input
            required
            value={command.name}
            onChange={(event) =>
              setCommand({ ...command, name: event.target.value })
            }
          />
        </label>
        <label>
          产品名称
          <input
            required
            value={command.product_name}
            onChange={(event) =>
              setCommand({ ...command, product_name: event.target.value })
            }
          />
        </label>
        <label>
          项目描述
          <textarea
            value={command.description}
            onChange={(event) =>
              setCommand({ ...command, description: event.target.value })
            }
          />
        </label>
        <button disabled={busy}>创建项目</button>
      </form>
      <form
        className="project-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void onSearch(search, sort);
        }}
      >
        <label>
          搜索项目
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          项目排序
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as ProjectSort)}
          >
            <option value="updated_desc">最近更新</option>
            <option value="name_asc">项目名称</option>
            <option value="created_asc">创建时间</option>
          </select>
        </label>
        <button>查找</button>
      </form>
      <div className="project-list">
        {projects === null && <p role="status">正在加载项目…</p>}
        {projects?.length === 0 && (
          <p className="workspace-empty">还没有项目</p>
        )}
        {projects?.map((project) => (
          <article key={project.id} className="project-card">
            <h3>{project.name}</h3>
            <p>{project.product_name}</p>
            <p>{project.product_version_count} 个产品版本</p>
            <div className="workspace-actions">
              <button type="button" onClick={() => onOpen(project.id)}>
                打开 {project.name}
              </button>
              <button type="button" onClick={() => onDelete(project.id)}>
                删除 {project.name}
              </button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}
