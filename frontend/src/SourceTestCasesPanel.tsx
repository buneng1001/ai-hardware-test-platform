import { useEffect, useState } from "react";

import {
  SourceTestCaseImportForm,
  defaultSourceTestCaseImportOptions,
} from "./SourceTestCaseImportForm";
import { SourceTestCaseImportRecords } from "./SourceTestCaseImportRecords";
import { SourceTestCaseList } from "./SourceTestCaseList";
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

export function SourceTestCasesPanel({
  productVersionId,
}: {
  productVersionId: number;
}) {
  const [draft, setDraft] = useState<SourceTestCaseImportDraft | null>(null);
  const [items, setItems] = useState<SourceTestCase[]>([]);
  const [records, setRecords] = useState<SourceTestCaseImportRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [deletionImpact, setDeletionImpact] =
    useState<ImportDeletionImpact | null>(null);

  const loadCases = async (nextFilters = filters) => {
    const result = await listSourceTestCases(productVersionId, nextFilters);
    setItems(result.items);
    if (Object.values(nextFilters).every((value) => !value)) {
      setSelectedIds(
        result.items.filter((item) => item.selected).map((item) => item.id),
      );
    }
  };
  const loadRecords = async () =>
    setRecords(await listSourceTestCaseImports(productVersionId));

  useEffect(() => {
    setDraft(null);
    setSelectedIds([]);
    setError(null);
    void Promise.all([loadCases({}), loadRecords()]).catch((caught) =>
      setError(caught instanceof Error ? caught.message : "原始用例加载失败"),
    );
  }, [productVersionId]);

  const previewFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
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
      setError(caught instanceof Error ? caught.message : "导入预览失败");
    }
  };

  const confirmImport = async () => {
    if (!draft) return;
    setError(null);
    try {
      await createSourceTestCaseImport(productVersionId, draft);
      setDraft(null);
      await Promise.all([loadCases({}), loadRecords()]);
      setFilters({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "原始用例导入失败");
    }
  };

  const saveSelection = async (nextSelectedIds: number[]) => {
    setError(null);
    try {
      await replaceSourceTestCaseSelection(productVersionId, nextSelectedIds);
      setSelectedIds(nextSelectedIds);
      setItems((current) =>
        current.map((item) => ({
          ...item,
          selected: nextSelectedIds.includes(item.id),
        })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "勾选保存失败");
    }
  };

  const updateFilters = async (field: string, value: string) => {
    const nextFilters = { ...filters, [field]: value };
    setFilters(nextFilters);
    try {
      await loadCases(nextFilters);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "筛选失败");
    }
  };

  const previewDeletion = async (recordId: number) => {
    try {
      setDeletionImpact(await getImportDeletionImpact(recordId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除影响加载失败");
    }
  };

  const confirmDeletion = async () => {
    if (!deletionImpact) return;
    try {
      await deleteSourceTestCaseImport(deletionImpact.import_record_id);
      setDeletionImpact(null);
      await Promise.all([loadCases(), loadRecords()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入记录删除失败");
    }
  };

  const updateVisibleSelection = (transform: (next: Set<number>) => void) => {
    const next = new Set(selectedIds);
    transform(next);
    void saveSelection([...next]);
  };

  return (
    <section className="source-case-panel" aria-labelledby="source-case-title">
      <header>
        <p className="eyebrow">用例资产</p>
        <h3 id="source-case-title">原始测试用例</h3>
        <p>导入资料前先确认字段映射；原始数据不会被后续自动化转换覆盖。</p>
      </header>
      {error && <p role="alert">{error}</p>}
      <SourceTestCaseImportForm
        draft={draft}
        onPreview={(file) => void previewFile(file)}
        onDraftChange={setDraft}
        onConfirm={() => void confirmImport()}
      />
      <SourceTestCaseList
        items={items}
        filters={filters}
        selectedIds={selectedIds}
        onFilterChange={(field, value) => void updateFilters(field, value)}
        onSelectAll={() =>
          updateVisibleSelection((next) =>
            items.forEach((item) => next.add(item.id)),
          )
        }
        onInvert={() =>
          updateVisibleSelection((next) =>
            items.forEach((item) =>
              next.has(item.id) ? next.delete(item.id) : next.add(item.id),
            ),
          )
        }
        onToggle={(item) =>
          updateVisibleSelection((next) =>
            next.has(item.id) ? next.delete(item.id) : next.add(item.id),
          )
        }
      />
      <SourceTestCaseImportRecords
        records={records}
        deletionImpact={deletionImpact}
        onPreviewDeletion={(recordId) => void previewDeletion(recordId)}
        onCancelDeletion={() => setDeletionImpact(null)}
        onConfirmDeletion={() => void confirmDeletion()}
      />
    </section>
  );
}
