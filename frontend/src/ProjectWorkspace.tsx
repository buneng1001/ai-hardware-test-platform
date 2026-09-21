import { useEffect, useState } from "react";

import { DeletionImpactDialog } from "./DeletionImpactDialog";
import { ProjectDetailPanel, type VersionCommand } from "./ProjectDetailPanel";
import { ProjectListPanel, type ProjectCommand } from "./ProjectListPanel";
import {
  createProductVersion,
  createProject,
  deleteProductVersion,
  deleteProject,
  getProject,
  getProjectDeletionImpact,
  getProjectTrend,
  getVersionDeletionImpact,
  listProjects,
  updateProductVersion,
  type ProductVersion,
  type ProjectDeletionImpact,
  type ProjectDetail,
  type ProjectSummary,
  type ProjectTrend,
  type VersionDeletionImpact,
} from "./projectsApi";
import "./projectWorkspace.css";

type PendingDeletion =
  | { kind: "project"; id: number; impact: ProjectDeletionImpact }
  | { kind: "version"; id: number; impact: VersionDeletionImpact };

function summaryFromDetail(project: ProjectDetail): ProjectSummary {
  const { product_versions: _versions, ...summary } = project;
  return summary;
}

export function ProjectWorkspace() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [selected, setSelected] = useState<ProjectDetail | null>(null);
  const [openedVersion, setOpenedVersion] = useState<ProductVersion | null>(
    null,
  );
  const [trend, setTrend] = useState<ProjectTrend | null>(null);
  const [pendingDeletion, setPendingDeletion] =
    useState<PendingDeletion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = async (search: string, selectedSort: string) => {
    setError(null);
    try {
      setProjects(await listProjects(search, selectedSort));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目列表加载失败");
    }
  };

  useEffect(() => {
    void loadProjects("", "updated_desc");
  }, []);

  const submitProject = async (command: ProjectCommand) => {
    setBusy(true);
    setError(null);
    try {
      const created = await createProject(command);
      setProjects((current) => [
        summaryFromDetail(created),
        ...(current ?? []),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目创建失败");
    } finally {
      setBusy(false);
    }
  };

  const openProject = async (projectId: number) => {
    setError(null);
    try {
      const [detail, projectTrend] = await Promise.all([
        getProject(projectId),
        getProjectTrend(projectId),
      ]);
      setSelected(detail);
      setTrend(projectTrend);
      setOpenedVersion(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目打开失败");
    }
  };

  const submitVersion = async (command: VersionCommand) => {
    if (!selected) return;
    setBusy(true);
    try {
      const created = await createProductVersion(selected.id, command);
      setSelected({
        ...selected,
        product_versions: [...selected.product_versions, created],
        product_version_count: selected.product_version_count + 1,
      });
      setProjects(
        (current) =>
          current?.map((item) =>
            item.id === selected.id
              ? {
                  ...item,
                  product_version_count: item.product_version_count + 1,
                }
              : item,
          ) ?? null,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "产品版本创建失败");
    } finally {
      setBusy(false);
    }
  };

  const editVersion = async (
    versionId: number,
    name: string,
    description: string,
  ) => {
    const updated = await updateProductVersion(versionId, {
      name,
      description,
    });
    setSelected((current) =>
      current
        ? {
            ...current,
            product_versions: current.product_versions.map((item) =>
              item.id === versionId ? updated : item,
            ),
          }
        : current,
    );
    setOpenedVersion((current) =>
      current?.id === versionId ? updated : current,
    );
  };

  const previewProjectDeletion = async (projectId: number) => {
    setPendingDeletion({
      kind: "project",
      id: projectId,
      impact: await getProjectDeletionImpact(projectId),
    });
  };

  const previewVersionDeletion = async (version: ProductVersion) => {
    setPendingDeletion({
      kind: "version",
      id: version.id,
      impact: await getVersionDeletionImpact(version.id),
    });
  };

  const confirmDeletion = async () => {
    if (!pendingDeletion) return;
    setBusy(true);
    try {
      if (pendingDeletion.kind === "project") {
        await deleteProject(pendingDeletion.id);
        setProjects(
          (current) =>
            current?.filter((item) => item.id !== pendingDeletion.id) ?? null,
        );
        if (selected?.id === pendingDeletion.id) setSelected(null);
      } else {
        await deleteProductVersion(pendingDeletion.id);
        const projectId = selected?.id;
        setSelected((current) =>
          current
            ? {
                ...current,
                product_versions: current.product_versions.filter(
                  (item) => item.id !== pendingDeletion.id,
                ),
                product_version_count: current.product_version_count - 1,
              }
            : current,
        );
        if (projectId !== undefined) {
          setProjects(
            (current) =>
              current?.map((item) =>
                item.id === projectId
                  ? {
                      ...item,
                      product_version_count: item.product_version_count - 1,
                    }
                  : item,
              ) ?? null,
          );
        }
        if (openedVersion?.id === pendingDeletion.id) setOpenedVersion(null);
      }
      setPendingDeletion(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const dialogData =
    pendingDeletion?.kind === "project"
      ? {
          versions: pendingDeletion.impact.product_versions,
          counts: pendingDeletion.impact.asset_counts,
          total: pendingDeletion.impact.total_affected_assets,
        }
      : pendingDeletion
        ? {
            versions: [pendingDeletion.impact.product_version],
            counts: pendingDeletion.impact.asset_counts,
            total: pendingDeletion.impact.total_affected_assets,
          }
        : null;

  return (
    <section
      className="project-workspace"
      aria-labelledby="project-workspace-title"
    >
      <header className="workspace-header">
        <p className="eyebrow">v0.2.0 项目工作区</p>
        <h2 id="project-workspace-title">项目与产品版本</h2>
        <p>项目用于长期管理产品；产品版本用于隔离每个 Beta 版本的测试资产。</p>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="workspace-grid">
        <ProjectListPanel
          projects={projects}
          busy={busy}
          onCreate={submitProject}
          onSearch={loadProjects}
          onOpen={(projectId) => void openProject(projectId)}
          onDelete={(projectId) => void previewProjectDeletion(projectId)}
        />
        <ProjectDetailPanel
          project={selected}
          trend={trend}
          openedVersion={openedVersion}
          busy={busy}
          onCreateVersion={submitVersion}
          onOpenVersion={setOpenedVersion}
          onEditVersion={editVersion}
          onDeleteVersion={(version) => void previewVersionDeletion(version)}
        />
      </div>
      {pendingDeletion && dialogData && (
        <DeletionImpactDialog
          target={pendingDeletion.kind}
          versions={dialogData.versions}
          counts={dialogData.counts}
          total={dialogData.total}
          busy={busy}
          onCancel={() => setPendingDeletion(null)}
          onConfirm={() => void confirmDeletion()}
        />
      )}
    </section>
  );
}
