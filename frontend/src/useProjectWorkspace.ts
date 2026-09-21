import { useEffect, useState } from "react";

import {
  projectWorkspaceHash,
  projectWorkspaceRouteFromHash,
} from "./projectWorkspaceRoute";
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
  type ProjectCommand,
  type ProjectDeletionImpact,
  type ProjectDetail,
  type ProjectSort,
  type ProjectSummary,
  type ProjectTrend,
  type VersionDeletionImpact,
  type VersionCommand,
} from "./projectsApi";

type PendingDeletion =
  | { kind: "project"; id: number; impact: ProjectDeletionImpact }
  | { kind: "version"; id: number; impact: VersionDeletionImpact };

function summaryFromDetail(project: ProjectDetail): ProjectSummary {
  const { product_versions: _versions, ...summary } = project;
  return summary;
}

export function useProjectWorkspace() {
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

  const loadProjects = async (search: string, sort: ProjectSort) => {
    setError(null);
    try {
      setProjects(await listProjects(search, sort));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目列表加载失败");
    }
  };

  const loadProject = async (projectId: number, versionId?: number) => {
    setError(null);
    try {
      const [detail, projectTrend] = await Promise.all([
        getProject(projectId),
        getProjectTrend(projectId),
      ]);
      setSelected(detail);
      setTrend(projectTrend);
      setOpenedVersion(
        versionId === undefined
          ? null
          : (detail.product_versions.find((item) => item.id === versionId) ??
              null),
      );
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目打开失败");
      return false;
    }
  };

  useEffect(() => {
    void loadProjects("", "updated_desc");
    const route = projectWorkspaceRouteFromHash();
    if (route) void loadProject(route.projectId, route.versionId);
    const restoreRoute = () => {
      const nextRoute = projectWorkspaceRouteFromHash();
      if (nextRoute) {
        void loadProject(nextRoute.projectId, nextRoute.versionId);
        return;
      }
      if (window.location.hash === "#projects") {
        setSelected(null);
        setOpenedVersion(null);
        setTrend(null);
        setPendingDeletion(null);
        setError(null);
      }
    };
    window.addEventListener("hashchange", restoreRoute);
    return () => window.removeEventListener("hashchange", restoreRoute);
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
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目创建失败");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openProject = async (projectId: number) => {
    if (await loadProject(projectId))
      window.history.pushState({}, "", projectWorkspaceHash(projectId));
  };

  const submitVersion = async (command: VersionCommand) => {
    if (!selected) return false;
    setBusy(true);
    setError(null);
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
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "产品版本创建失败");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openVersion = (version: ProductVersion) => {
    setOpenedVersion(version);
    window.history.pushState(
      {},
      "",
      projectWorkspaceHash(version.project_id, version.id),
    );
  };

  const editVersion = async (
    versionId: number,
    name: string,
    description: string,
  ) => {
    setError(null);
    try {
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
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "产品版本保存失败");
      return false;
    }
  };

  const previewProjectDeletion = async (projectId: number) => {
    try {
      setPendingDeletion({
        kind: "project",
        id: projectId,
        impact: await getProjectDeletionImpact(projectId),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除影响加载失败");
    }
  };

  const previewVersionDeletion = async (version: ProductVersion) => {
    try {
      setPendingDeletion({
        kind: "version",
        id: version.id,
        impact: await getVersionDeletionImpact(version.id),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除影响加载失败");
    }
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
        if (selected?.id === pendingDeletion.id) {
          setSelected(null);
          window.history.pushState({}, "", "#projects");
        }
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
          if (openedVersion?.id === pendingDeletion.id) {
            setOpenedVersion(null);
            window.history.pushState({}, "", projectWorkspaceHash(projectId));
          }
        }
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

  return {
    projects,
    selected,
    openedVersion,
    trend,
    pendingDeletion,
    dialogData,
    busy,
    error,
    loadProjects,
    submitProject,
    openProject,
    submitVersion,
    openVersion,
    editVersion,
    previewProjectDeletion,
    previewVersionDeletion,
    confirmDeletion,
    cancelDeletion: () => setPendingDeletion(null),
  };
}
