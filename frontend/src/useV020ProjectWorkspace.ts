import { useState } from "react";

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

export type V020PendingDeletion =
  | { kind: "project"; id: number; impact: ProjectDeletionImpact }
  | { kind: "version"; id: number; impact: VersionDeletionImpact };

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * V020 冻结页面的项目与产品版本数据源。
 * 只负责调用既有项目接口并维护加载、失败、重试状态，不包含页面跳转和路由。
 */
export function useV020ProjectWorkspace() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ProjectSort>("updated_desc");
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [lastProjectId, setLastProjectId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [trend, setTrend] = useState<ProjectTrend | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [openedVersion, setOpenedVersion] = useState<ProductVersion | null>(
    null,
  );
  const [pendingDeletion, setPendingDeletion] =
    useState<V020PendingDeletion | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadProjects = async (nextSearch: string, nextSort: ProjectSort) => {
    setProjectsError(null);
    try {
      setProjects(await listProjects(nextSearch, nextSort));
    } catch (caught) {
      setProjects(null);
      setProjectsError(errorMessage(caught, "项目列表加载失败"));
    }
  };

  const loadTrend = async (projectId: number) => {
    setTrendError(null);
    try {
      setTrend(await getProjectTrend(projectId));
    } catch (caught) {
      setTrend(null);
      setTrendError(errorMessage(caught, "趋势数据加载失败"));
    }
  };

  const openProject = async (projectId: number): Promise<boolean> => {
    setLastProjectId(projectId);
    setDetailLoading(true);
    setDetailError(null);
    setTrendError(null);
    try {
      const project = await getProject(projectId);
      setDetail(project);
      setOpenedVersion(project.product_versions[0] ?? null);
      await loadTrend(projectId);
      return true;
    } catch (caught) {
      setDetail(null);
      setTrend(null);
      setDetailError(errorMessage(caught, "项目打开失败"));
      return false;
    } finally {
      setDetailLoading(false);
    }
  };

  const reloadProject = async (): Promise<boolean> => {
    const projectId = detail?.id ?? lastProjectId;
    if (projectId === null) return false;
    return openProject(projectId);
  };

  const submitProject = async (command: ProjectCommand): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      const created = await createProject(command);
      await loadProjects(search, sort);
      setDetail(created);
      setOpenedVersion(created.product_versions[0] ?? null);
      await loadTrend(created.id);
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught, "项目创建失败"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitVersion = async (command: VersionCommand): Promise<boolean> => {
    if (!detail) return false;
    setBusy(true);
    setActionError(null);
    try {
      const created = await createProductVersion(detail.id, command);
      const nextDetail: ProjectDetail = {
        ...detail,
        product_versions: [...detail.product_versions, created],
        product_version_count: detail.product_version_count + 1,
      };
      setDetail(nextDetail);
      setOpenedVersion(created);
      setProjects(
        (current) =>
          current?.map((item) =>
            item.id === detail.id
              ? {
                  ...item,
                  product_version_count: nextDetail.product_version_count,
                }
              : item,
          ) ?? null,
      );
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught, "产品版本创建失败"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const editVersion = async (
    versionId: number,
    name: string,
    description: string,
  ): Promise<boolean> => {
    setActionError(null);
    try {
      const updated = await updateProductVersion(versionId, {
        name,
        description,
      });
      setDetail((current) =>
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
      setActionError(errorMessage(caught, "产品版本保存失败"));
      return false;
    }
  };

  const previewProjectDeletion = async (projectId: number) => {
    setActionError(null);
    try {
      setPendingDeletion({
        kind: "project",
        id: projectId,
        impact: await getProjectDeletionImpact(projectId),
      });
    } catch (caught) {
      setActionError(errorMessage(caught, "删除影响加载失败"));
    }
  };

  const previewVersionDeletion = async (version: ProductVersion) => {
    setActionError(null);
    try {
      setPendingDeletion({
        kind: "version",
        id: version.id,
        impact: await getVersionDeletionImpact(version.id),
      });
    } catch (caught) {
      setActionError(errorMessage(caught, "删除影响加载失败"));
    }
  };

  const confirmDeletion = async () => {
    if (!pendingDeletion) return;
    setBusy(true);
    setActionError(null);
    try {
      if (pendingDeletion.kind === "project") {
        await deleteProject(pendingDeletion.id);
        setProjects(
          (current) =>
            current?.filter((item) => item.id !== pendingDeletion.id) ?? null,
        );
        if (detail?.id === pendingDeletion.id) {
          setDetail(null);
          setTrend(null);
          setOpenedVersion(null);
        }
      } else {
        await deleteProductVersion(pendingDeletion.id);
        setDetail((current) =>
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
        if (detail) {
          setProjects(
            (current) =>
              current?.map((item) =>
                item.id === detail.id
                  ? {
                      ...item,
                      product_version_count: item.product_version_count - 1,
                    }
                  : item,
              ) ?? null,
          );
        }
        setOpenedVersion((current) =>
          current?.id === pendingDeletion.id ? null : current,
        );
      }
      setPendingDeletion(null);
    } catch (caught) {
      setActionError(errorMessage(caught, "删除失败"));
    } finally {
      setBusy(false);
    }
  };

  return {
    projects,
    projectsError,
    search,
    sort,
    setSearch,
    setSort,
    refreshProjects: () => loadProjects(search, sort),
    submitProject,
    detail,
    detailLoading,
    detailError,
    reloadProject,
    trend,
    trendError,
    openedVersion,
    setOpenedVersion,
    openProject,
    submitVersion,
    editVersion,
    pendingDeletion,
    previewProjectDeletion,
    previewVersionDeletion,
    confirmDeletion,
    cancelDeletion: () => setPendingDeletion(null),
    busy,
    actionError,
    retryTrend: () => (detail ? loadTrend(detail.id) : Promise.resolve()),
  };
}

export type V020ProjectWorkspace = ReturnType<typeof useV020ProjectWorkspace>;
