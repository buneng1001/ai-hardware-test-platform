import { type FormEvent, useState } from "react";

import { ProductVersionList } from "./ProductVersionList";
import type {
  ProductVersion,
  ProjectDetail,
  ProjectTrend,
} from "./projectsApi";

export type VersionCommand = {
  version: string;
  name: string;
  description: string;
};

type ProjectDetailPanelProps = {
  project: ProjectDetail | null;
  trend: ProjectTrend | null;
  openedVersion: ProductVersion | null;
  busy: boolean;
  onCreateVersion: (command: VersionCommand) => Promise<void>;
  onOpenVersion: (version: ProductVersion) => void;
  onEditVersion: (
    versionId: number,
    name: string,
    description: string,
  ) => Promise<void>;
  onDeleteVersion: (version: ProductVersion) => void;
};

const emptyCommand = { version: "", name: "", description: "" };

export function ProjectDetailPanel({
  project,
  trend,
  openedVersion,
  busy,
  onCreateVersion,
  onOpenVersion,
  onEditVersion,
  onDeleteVersion,
}: ProjectDetailPanelProps) {
  const [command, setCommand] = useState<VersionCommand>(emptyCommand);

  const submitVersion = async (event: FormEvent) => {
    event.preventDefault();
    await onCreateVersion(command);
    setCommand(emptyCommand);
  };

  return (
    <div className="workspace-panel workspace-detail">
      {!project && (
        <div className="workspace-empty">
          <h3>选择一个项目</h3>
          <p>打开项目后可管理产品版本和查看趋势。</p>
        </div>
      )}
      {project && (
        <>
          <header>
            <p className="eyebrow">{project.product_name}</p>
            <h3>{project.name}</h3>
            <p>{project.description || "未填写项目描述"}</p>
          </header>
          <section className="trend-empty" aria-label="项目趋势">
            <h4>项目趋势</h4>
            <p>{trend?.message ?? "正在加载趋势…"}</p>
          </section>
          <form
            className="workspace-form version-create"
            onSubmit={(event) => void submitVersion(event)}
          >
            <h3>新建产品版本</h3>
            <label>
              版本号
              <input
                required
                value={command.version}
                onChange={(event) =>
                  setCommand({ ...command, version: event.target.value })
                }
              />
            </label>
            <label>
              版本名称（可选）
              <input
                value={command.name}
                onChange={(event) =>
                  setCommand({ ...command, name: event.target.value })
                }
              />
            </label>
            <label>
              版本描述（可选）
              <textarea
                value={command.description}
                onChange={(event) =>
                  setCommand({ ...command, description: event.target.value })
                }
              />
            </label>
            <button disabled={busy}>新建产品版本</button>
          </form>
          <ProductVersionList
            versions={project.product_versions}
            onOpen={onOpenVersion}
            onEdit={onEditVersion}
            onDelete={onDeleteVersion}
          />
          {openedVersion && (
            <section className="opened-version" aria-label="产品版本工作区">
              <p className="eyebrow">当前产品版本</p>
              <h3>{openedVersion.version}</h3>
              <p>{openedVersion.name || "未填写版本名称"}</p>
              <p>
                {openedVersion.description ||
                  "可直接开始导入测试资产，无需预填测试范围或阶段目标。"}
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
