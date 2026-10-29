import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteDataPackage,
  getDataPackage,
  getDataPackageDeletionImpact,
  listDataPackages,
  registerCompletedDataPackages,
  type DataPackage,
  type DataPackageDeletionImpact,
  type DataPackageFilters,
} from "./dataPackagesApi";

export type DataPackageLoadStatus = "loading" | "ready" | "error";

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * V020 冻结页面“测试数据”的数据源。
 * 只调用既有数据包接口，维护筛选、加载、登记、详情和删除影响状态。
 */
export function useV020DataPackages() {
  const [status, setStatus] = useState<DataPackageLoadStatus>("loading");
  const [items, setItems] = useState<DataPackage[]>([]);
  const [filters, setFilters] = useState<DataPackageFilters>({});
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DataPackage | null>(null);
  const [impact, setImpact] = useState<DataPackageDeletionImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestToken = useRef(0);

  const load = useCallback(async (nextFilters: DataPackageFilters) => {
    const token = requestToken.current + 1;
    requestToken.current = token;
    setStatus("loading");
    setError(null);
    try {
      const result = await listDataPackages(nextFilters);
      if (requestToken.current !== token) return;
      setItems(result.items);
      setStatus("ready");
    } catch (caught) {
      if (requestToken.current !== token) return;
      setStatus("error");
      setError(errorMessage(caught, "数据包加载失败"));
    }
  }, []);

  useEffect(() => {
    void load({});
  }, [load]);

  const retry = () => void load(filters);

  const updateFilters = async (next: DataPackageFilters) => {
    setFilters(next);
    setActionError(null);
    setMessage(null);
    await load(next);
  };

  /** 搜索只在已加载结果内按编号或来源任务名过滤，不新增后端接口。 */
  const visibleItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter(
      (item) =>
        item.package_number.toLowerCase().includes(keyword) ||
        item.source_task_name.toLowerCase().includes(keyword),
    );
  }, [items, search]);

  const registerCompleted = async () => {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const result = await registerCompletedDataPackages();
      setItems(result.items);
      setStatus("ready");
      setMessage("已登记所有已完成的数据任务结果；原始运行记录未被修改。");
    } catch (caught) {
      setActionError(errorMessage(caught, "登记已完成数据任务失败"));
    } finally {
      setBusy(false);
    }
  };

  const showDetail = async (packageId: number) => {
    setBusy(true);
    setActionError(null);
    try {
      setSelected(await getDataPackage(packageId));
    } catch (caught) {
      setActionError(errorMessage(caught, "数据包详情加载失败"));
    } finally {
      setBusy(false);
    }
  };

  const previewDeletion = async (packageId: number) => {
    setActionError(null);
    try {
      setImpact(await getDataPackageDeletionImpact(packageId));
    } catch (caught) {
      setActionError(errorMessage(caught, "删除影响加载失败"));
    }
  };

  const confirmDeletion = async () => {
    if (!impact) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteDataPackage(impact.data_package_id);
      setItems((current) =>
        current.filter((item) => item.id !== impact.data_package_id),
      );
      setSelected((current) =>
        current?.id === impact.data_package_id ? null : current,
      );
      setMessage(
        `${impact.package_number} 已删除；来源任务和 v0.1.0 运行记录仍保留。`,
      );
      setImpact(null);
    } catch (caught) {
      setActionError(errorMessage(caught, "数据包删除失败"));
    } finally {
      setBusy(false);
    }
  };

  return {
    status,
    items,
    visibleItems,
    filters,
    search,
    setSearch,
    selected,
    impact,
    busy,
    error,
    actionError,
    message,
    retry,
    updateFilters,
    registerCompleted,
    showDetail,
    closeDetail: () => setSelected(null),
    previewDeletion,
    cancelDeletion: () => setImpact(null),
    confirmDeletion,
  };
}

export type V020DataPackages = ReturnType<typeof useV020DataPackages>;
