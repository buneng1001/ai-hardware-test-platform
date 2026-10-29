import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { defaultSourceTestCaseImportOptions } from "./SourceTestCaseImportForm";
import {
  collectFilterOptions,
  compactFilters,
  emptySourceCaseFilters,
  hasActiveFilters,
  matchSelected,
  type SourceCaseFilters,
} from "./sourceCaseQuery";
import {
  createSourceTestCaseImport,
  deleteSourceTestCaseImport,
  getImportDeletionImpact,
  listSourceTestCaseImports,
  listSourceTestCases,
  previewSourceTestCaseImport,
  replaceSourceTestCaseSelection,
  type ImportDeletionImpact,
  type SourceTestCase,
  type SourceTestCaseImportDraft,
  type SourceTestCaseImportRecord,
} from "./sourceTestCasesApi";

export type SourceCaseLoadStatus = "idle" | "loading" | "ready" | "error";

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * V020 冻结页面“需求 / 测试用例”的原始用例数据源。
 * 只调用既有产品版本接口，维护加载、空、失败、重试和勾选持久化状态。
 */
export function useV020SourceTestCases(productVersionId: number | null) {
  const [status, setStatus] = useState<SourceCaseLoadStatus>("idle");
  const [items, setItems] = useState<SourceTestCase[]>([]);
  const [allItems, setAllItems] = useState<SourceTestCase[]>([]);
  const [records, setRecords] = useState<SourceTestCaseImportRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [filters, setFilters] = useState<SourceCaseFilters>(
    emptySourceCaseFilters,
  );
  const [draft, setDraft] = useState<SourceTestCaseImportDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletionImpact, setDeletionImpact] =
    useState<ImportDeletionImpact | null>(null);
  // 请求序号用于丢弃切换版本后返回的旧响应，避免覆盖当前版本数据。
  const requestToken = useRef(0);

  /** 一次性加载全部用例、当前筛选结果和导入记录，并恢复已保存的勾选清单。 */
  const loadVersion = useCallback(
    async (versionId: number, nextFilters: SourceCaseFilters) => {
      const token = requestToken.current + 1;
      requestToken.current = token;
      setStatus("loading");
      setError(null);
      setActionError(null);
      try {
        const [all, filtered, loadedRecords] = await Promise.all([
          listSourceTestCases(versionId, {}),
          hasActiveFilters(nextFilters)
            ? listSourceTestCases(versionId, compactFilters(nextFilters))
            : Promise.resolve(null),
          listSourceTestCaseImports(versionId),
        ]);
        if (requestToken.current !== token) return;
        setAllItems(all.items);
        setItems(filtered ? filtered.items : all.items);
        setSelectedIds(
          all.items.filter((item) => item.selected).map((item) => item.id),
        );
        setRecords(loadedRecords);
        setStatus("ready");
      } catch (caught) {
        if (requestToken.current !== token) return;
        setStatus("error");
        setError(errorMessage(caught, "原始测试用例加载失败"));
      }
    },
    [],
  );

  useEffect(() => {
    setDraft(null);
    setDeletionImpact(null);
    setFilters(emptySourceCaseFilters);
    if (productVersionId === null) {
      requestToken.current += 1;
      setStatus("idle");
      setItems([]);
      setAllItems([]);
      setRecords([]);
      setSelectedIds([]);
      setError(null);
      setActionError(null);
      return;
    }
    void loadVersion(productVersionId, emptySourceCaseFilters);
  }, [productVersionId, loadVersion]);

  const retry = () => {
    if (productVersionId === null) return;
    void loadVersion(productVersionId, filters);
  };

  const updateFilter = async (
    field: keyof SourceCaseFilters,
    value: string,
  ) => {
    const next = { ...filters, [field]: value };
    setFilters(next);
    if (productVersionId === null) return;
    setActionError(null);
    try {
      const result = await listSourceTestCases(
        productVersionId,
        compactFilters(next),
      );
      setItems(result.items);
    } catch (caught) {
      setActionError(errorMessage(caught, "筛选失败"));
    }
  };

  /** 勾选清单按产品版本保存到后端，刷新或重新打开页面后仍可恢复。 */
  const persistSelection = async (nextIds: number[]) => {
    if (productVersionId === null) return;
    setBusy(true);
    setActionError(null);
    try {
      const saved = await replaceSourceTestCaseSelection(
        productVersionId,
        nextIds,
      );
      const savedSet = new Set(saved.source_test_case_ids);
      setSelectedIds(saved.source_test_case_ids);
      setItems((current) => current.map(matchSelected(savedSet)));
      setAllItems((current) => current.map(matchSelected(savedSet)));
    } catch (caught) {
      setActionError(errorMessage(caught, "勾选保存失败"));
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (itemId: number) => {
    const next = selectedIds.includes(itemId)
      ? selectedIds.filter((id) => id !== itemId)
      : [...selectedIds, itemId];
    void persistSelection(next);
  };

  const selectAllFiltered = () => {
    const next = new Set([...selectedIds, ...items.map((item) => item.id)]);
    void persistSelection([...next]);
  };

  const invertFiltered = () => {
    const next = new Set(selectedIds);
    items.forEach((item) =>
      next.has(item.id) ? next.delete(item.id) : next.add(item.id),
    );
    void persistSelection([...next]);
  };

  const previewFile = async (file: File | undefined) => {
    if (!file || productVersionId === null) return;
    setBusy(true);
    setActionError(null);
    try {
      const preview = await previewSourceTestCaseImport(productVersionId, file);
      setDraft({
        ...preview,
        import_options: {
          ...defaultSourceTestCaseImportOptions,
          ...preview.import_options,
        },
      });
    } catch (caught) {
      setActionError(errorMessage(caught, "导入预览失败"));
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!draft || productVersionId === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await createSourceTestCaseImport(productVersionId, draft);
      setDraft(null);
      setFilters(emptySourceCaseFilters);
      await loadVersion(productVersionId, emptySourceCaseFilters);
    } catch (caught) {
      setActionError(errorMessage(caught, "原始用例导入失败"));
    } finally {
      setBusy(false);
    }
  };

  const previewDeletion = async (importId: number) => {
    setActionError(null);
    try {
      setDeletionImpact(await getImportDeletionImpact(importId));
    } catch (caught) {
      setActionError(errorMessage(caught, "删除影响加载失败"));
    }
  };

  const confirmDeletion = async () => {
    if (!deletionImpact || productVersionId === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteSourceTestCaseImport(deletionImpact.import_record_id);
      setDeletionImpact(null);
      await loadVersion(productVersionId, filters);
    } catch (caught) {
      setActionError(errorMessage(caught, "导入记录删除失败"));
    } finally {
      setBusy(false);
    }
  };

  const filterOptions = useMemo(
    () => collectFilterOptions(allItems),
    [allItems],
  );

  return {
    status,
    items,
    records,
    selectedIds,
    totalCount: allItems.length,
    filters,
    filterOptions,
    draft,
    error,
    actionError,
    busy,
    deletionImpact,
    retry,
    updateFilter,
    toggleSelect,
    selectAllFiltered,
    invertFiltered,
    previewFile,
    updateDraft: setDraft,
    confirmImport,
    previewDeletion,
    cancelDeletion: () => setDeletionImpact(null),
    confirmDeletion,
  };
}

export type V020SourceTestCases = ReturnType<typeof useV020SourceTestCases>;
