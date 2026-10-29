import { useCallback, useEffect, useRef, useState } from "react";

import {
  createTestGroup,
  deleteTestGroup,
  getTestGroup,
  getTestGroupDeletionImpact,
  listTestGroups,
  setTestGroupHidden,
  updateTestGroup,
  type TestGroupDeletionImpact,
  type TestGroupDetail,
  type TestGroupPage,
} from "./testGroupsApi";

export type TestGroupLoadStatus = "idle" | "loading" | "ready" | "error";

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * V020 冻结页面“测试组设置”的数据源。
 * 只调用既有测试组接口，维护列表、创建、详情、隐藏和删除影响状态。
 */
export function useV020TestGroups(productVersionId: number | null) {
  const [status, setStatus] = useState<TestGroupLoadStatus>("idle");
  const [page, setPage] = useState<TestGroupPage | null>(null);
  const [detail, setDetail] = useState<TestGroupDetail | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const [showHidden, setShowHidden] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [impact, setImpact] = useState<TestGroupDeletionImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestToken = useRef(0);

  const load = useCallback(async () => {
    if (productVersionId === null) return;
    const token = requestToken.current + 1;
    requestToken.current = token;
    setStatus("loading");
    setError(null);
    try {
      const result = await listTestGroups(productVersionId, {
        search,
        sort,
        hidden: showHidden ? undefined : false,
        page: currentPage,
      });
      if (requestToken.current !== token) return;
      setPage(result);
      setStatus("ready");
    } catch (caught) {
      if (requestToken.current !== token) return;
      setStatus("error");
      setError(errorMessage(caught, "测试组加载失败"));
    }
  }, [productVersionId, search, sort, showHidden, currentPage]);

  useEffect(() => {
    if (productVersionId === null) {
      requestToken.current += 1;
      setStatus("idle");
      setPage(null);
      setDetail(null);
      return;
    }
    void load();
  }, [productVersionId, load]);

  const updateSearch = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };
  const updateSort = (value: string) => {
    setSort(value);
    setCurrentPage(1);
  };
  const updateShowHidden = (value: boolean) => {
    setShowHidden(value);
    setCurrentPage(1);
  };

  const openDetail = async (groupId: number) => {
    setBusy(true);
    setActionError(null);
    try {
      setDetail(await getTestGroup(groupId));
    } catch (caught) {
      setActionError(errorMessage(caught, "测试组详情加载失败"));
    } finally {
      setBusy(false);
    }
  };

  const applyDetail = (next: TestGroupDetail) => {
    setDetail(next);
    void load();
  };

  const createGroup = async (
    name: string,
    description: string,
    includeSelected: boolean,
  ): Promise<boolean> => {
    if (productVersionId === null) return false;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const created = await createTestGroup(productVersionId, {
        name,
        description,
        include_selected_source_cases: includeSelected,
      });
      setDetail(created);
      await load();
      setMessage("测试组已创建。");
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught, "测试组创建失败"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDescription = async (description: string) => {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      applyDetail(
        await updateTestGroup(detail.id, {
          name: detail.name,
          description,
        }),
      );
      setMessage("测试组说明已保存。");
    } catch (caught) {
      setActionError(errorMessage(caught, "测试组说明保存失败"));
    } finally {
      setBusy(false);
    }
  };

  const toggleHidden = async () => {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      applyDetail(await setTestGroupHidden(detail.id, !detail.hidden));
      setMessage(detail.hidden ? "已恢复显示。" : "已隐藏。");
    } catch (caught) {
      setActionError(errorMessage(caught, "测试组显示状态更新失败"));
    } finally {
      setBusy(false);
    }
  };

  const previewDeletion = async (groupId: number) => {
    setActionError(null);
    try {
      setImpact(await getTestGroupDeletionImpact(groupId));
    } catch (caught) {
      setActionError(errorMessage(caught, "删除影响加载失败"));
    }
  };

  const confirmDeletion = async () => {
    if (!impact) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteTestGroup(impact.test_group_id);
      setDetail((current) =>
        current?.id === impact.test_group_id ? null : current,
      );
      setImpact(null);
      await load();
      setMessage(`${impact.name} 已删除；平台级用例和数据包保留。`);
    } catch (caught) {
      setActionError(errorMessage(caught, "测试组删除失败"));
    } finally {
      setBusy(false);
    }
  };

  return {
    status,
    page,
    detail,
    search,
    sort,
    showHidden,
    currentPage,
    impact,
    busy,
    error,
    actionError,
    message,
    retry: () => void load(),
    setSearch: updateSearch,
    setSort: updateSort,
    setShowHidden: updateShowHidden,
    setCurrentPage,
    openDetail,
    closeDetail: () => setDetail(null),
    applyDetail,
    createGroup,
    saveDescription,
    toggleHidden,
    previewDeletion,
    cancelDeletion: () => setImpact(null),
    confirmDeletion,
  };
}

export type V020TestGroups = ReturnType<typeof useV020TestGroups>;
