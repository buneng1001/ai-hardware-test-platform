import { useEffect, useRef, useState } from "react";

import {
  convertSourceTestCasesWithAi,
  convertSourceTestCasesWithRules,
} from "./automationTestCasesApi";
import { V020CaseTemplatePanel } from "./V020CaseTemplatePanel";
import { V020AddToGroupDialog } from "./V020AddToGroupDialog";
import {
  V020AiGenerateDialog,
  type AiGenerateMode,
} from "./V020AiGenerateDialog";
import { V020SourceCaseImportPanel } from "./V020SourceCaseImportPanel";
import { V020SourceCaseRecords } from "./V020SourceCaseRecords";
import { V020SourceCaseTable } from "./V020SourceCaseTable";
import type { SourceCaseFilters } from "./sourceCaseQuery";
import { useV020SourceTestCases } from "./useV020SourceTestCases";
import "./V020SourceCases.css";

/** 模型给出的“没过哪条门槛”，用于人工复核清单。 */
const blockerLabels: Record<string, string> = {
  result_not_assertable: "结果无法断言",
  data_unavailable: "数据拿不到",
  subjective: "依赖主观判断",
  physical_action: "依赖物理操作",
  none: "未说明",
};

const filterControls: Array<[keyof SourceCaseFilters, string, string]> = [
  ["module", "模块筛选", "全部模块"],
  ["test_type", "测试类型筛选", "全部测试类型"],
  ["priority", "优先级筛选", "全部优先级"],
  ["software_version", "软件版本筛选", "全部软件版本"],
];

/**
 * 冻结版“测试用例表”页：读取当前产品版本的真实原始用例，
 * 补齐加载、空、失败、重试、筛选、勾选恢复和删除影响状态。
 */
export function V020SourceCasesScreen({
  versionId,
  versionLabel,
  focusCaseId,
  onOpenAutomation,
}: {
  versionId: number | null;
  versionLabel: string;
  focusCaseId: number | null;
  onOpenAutomation: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const source = useV020SourceTestCases(versionId);
  const [page, setPage] = useState(1);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [groupNotice, setGroupNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingWithAi, setGeneratingWithAi] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateNotice, setGenerateNotice] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<{
    automation: number;
    manual: number;
    created: number;
    updated: number;
    removed: number;
    manualItems: Array<{
      caseNumber: string;
      reason: string;
      blocker: string;
      expectedSignal: string;
      dataSource: string;
    }>;
    /** 判为自动化但预期结果没有可断言阈值的用例。 */
    vagueItems: Array<{ caseNumber: string; expectedResult: string }>;
  } | null>(null);

  // 每页固定 20 条；用例数量或筛选变化后回到第一页，避免停在空页。
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(source.items.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = source.items.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  useEffect(() => {
    setPage(1);
  }, [source.items]);

  if (versionId === null) {
    return (
      <div className="prototype-inline-note">
        请先在“版本与趋势”中打开一个产品版本，再导入原始测试用例。
      </div>
    );
  }

  if (source.status === "loading" || source.status === "idle") {
    return (
      <p className="prototype-muted" role="status">
        正在加载原始测试用例…
      </p>
    );
  }

  if (source.status === "error") {
    return (
      <div className="prototype-inline-note" role="alert">
        原始测试用例加载失败：{source.error}
        <button
          className="prototype-secondary"
          onClick={source.retry}
          type="button"
        >
          重试
        </button>
      </div>
    );
  }

  const pickFile = () => fileInputRef.current?.click();

  /** 读取首页保存的临时 API Key，让 AI 转换可以直接复用当前配置。 */
  const readTemporaryKey = () => {
    try {
      return window.sessionStorage.getItem("iris-test-temporary-ai-key") ?? "";
    } catch {
      return "";
    }
  };

  /** 规则转换不使用 AI，只作为没有模型时的兜底候选。 */
  const generateAutomationCases = async () => {
    if (versionId === null) return;
    setGenerating(true);
    setGenerateError(null);
    setGenerateNotice(null);
    setAiSummary(null);
    try {
      const result = await convertSourceTestCasesWithRules(versionId);
      if (result.created_count > 0) onOpenAutomation();
      else setGenerateNotice("没有新的原始用例需要转换；已有候选不会被覆盖。");
    } catch (caught) {
      setGenerateError(
        caught instanceof Error && caught.message
          ? caught.message
          : "规则转换失败",
      );
    } finally {
      setGenerating(false);
    }
  };

  /** AI 转换：把勾选的原始用例交给模型，由模型判定哪些可自动化、哪些转人工。 */
  const generateAutomationCasesWithAi = async (mode: AiGenerateMode) => {
    if (versionId === null) return;
    setAiDialogOpen(false);
    setGeneratingWithAi(true);
    setGenerateError(null);
    setGenerateNotice(null);
    try {
      // 按用户选的范围判定；selected 模式只带勾选的用例。
      const result = await convertSourceTestCasesWithAi(
        versionId,
        readTemporaryKey(),
        mode === "selected" ? source.selectedIds : [],
        mode,
      );
      const manual = result.decisions.filter(
        (item) => item.decision === "manual",
      );
      setAiSummary({
        automation: result.automation_count,
        manual: result.manual_count,
        created: result.created_count,
        updated: result.updated_count,
        removed: result.removed_count,
        manualItems: manual.map((item) => ({
          caseNumber: item.case_number,
          reason: item.reason,
          blocker: item.blocker ?? "none",
          expectedSignal: item.expected_signal ?? "",
          dataSource: item.data_source ?? "",
        })),
        // 预期结果里没有数字或比较符，说明执行时没法断言，提前提示去补。
        vagueItems: result.decisions
          .filter(
            (item) =>
              item.decision === "automation" &&
              !/[0-9]/.test(item.expected_result ?? "") &&
              !/[≥≤><=]/.test(item.expected_result ?? ""),
          )
          .map((item) => ({
            caseNumber: item.case_number,
            expectedResult: item.expected_result ?? "",
          })),
      });
      // 判定后重新拉一次原始用例，让“自动化/人工”标签立即更新。
      await source.retry();
    } catch (caught) {
      setGenerateError(
        caught instanceof Error && caught.message
          ? caught.message
          : "AI 转换失败",
      );
    } finally {
      setGeneratingWithAi(false);
    }
  };

  return (
    <>
      <V020CaseTemplatePanel />

      <div className="prototype-case-toolbar">
        <p className="prototype-muted">
          已选 {source.selectedIds.length} / 共 {source.totalCount} 条
        </p>
        <div className="prototype-filter-row prototype-source-filters">
          {filterControls.map(([field, label, emptyLabel]) => (
            <label key={field}>
              {emptyLabel.replace("全部", "")}
              <select
                aria-label={label}
                value={source.filters[field]}
                onChange={(event) =>
                  void source.updateFilter(field, event.target.value)
                }
              >
                <option value="">{emptyLabel}</option>
                {source.filterOptions[field].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="prototype-actions">
          <button onClick={pickFile} type="button">
            导入用例表
          </button>
          <input
            ref={fileInputRef}
            aria-label="选择 Beta 测试用例文件"
            accept=".csv,.xlsx"
            className="prototype-file-input"
            type="file"
            onChange={(event) => {
              void source.previewFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            className="prototype-primary"
            disabled={source.busy || generating || generatingWithAi}
            onClick={() => setAiDialogOpen(true)}
            type="button"
          >
            {generatingWithAi ? "AI 判定中…" : "AI 生成自动化用例"}
          </button>
          <button
            aria-pressed={source.onlyMissing}
            className={
              source.onlyMissing
                ? "prototype-secondary is-selected"
                : "prototype-secondary"
            }
            onClick={() => source.setOnlyMissing(!source.onlyMissing)}
            title="只显示还没有自动化版本的用例"
            type="button"
          >
            {source.onlyMissing ? "显示全部用例" : "只看未自动化"}
          </button>
          <button
            className="prototype-secondary"
            disabled={source.busy || generating || generatingWithAi}
            title="不使用 AI，仅按规则生成低可信度候选"
            onClick={() => void generateAutomationCases()}
            type="button"
          >
            {generating ? "规则转换中…" : "规则转换（不使用 AI）"}
          </button>
          <button
            className="prototype-secondary"
            onClick={() =>
              source.allFilteredSelected
                ? source.clearSelection()
                : source.selectAllFiltered()
            }
            type="button"
          >
            {source.allFilteredSelected ? "取消全选" : "全选"}
          </button>
          <button
            className="prototype-secondary"
            onClick={source.invertFiltered}
            type="button"
          >
            {source.inverted ? "取消反选" : "反选"}
          </button>
          <button
            className="prototype-secondary"
            onClick={() => {
              if (source.selectedIds.length === 0) {
                setGroupNotice("请先勾选要加入测试组的用例。");
                return;
              }
              setShowGroupDialog(true);
            }}
            type="button"
          >
            加入测试组（已选 {source.selectedIds.length} 条）
          </button>
        </div>
      </div>

      {source.actionError && (
        <div className="prototype-inline-note" role="alert">
          {source.actionError}
        </div>
      )}
      {aiSummary && (
        <div className="prototype-inline-note" aria-label="AI 判定结果">
          <p>
            AI 判定：<strong>{aiSummary.automation}</strong> 条可自动化，
            <strong>{aiSummary.manual}</strong>{" "}
            条转人工；没参与判定的用例默认按人工处理。
          </p>
          <p className="prototype-muted">
            新增 {aiSummary.created} 条候选，更新 {aiSummary.updated} 条， 移除{" "}
            {aiSummary.removed} 条转为人工的候选。
          </p>
          {aiSummary.vagueItems.length > 0 && (
            <div className="prototype-ai-vague">
              <p>
                有 <strong>{aiSummary.vagueItems.length}</strong>{" "}
                条自动化用例的预期结果没有可断言的阈值，执行时无法判定：
              </p>
              <ul>
                {aiSummary.vagueItems.slice(0, 5).map((item) => (
                  <li key={item.caseNumber}>
                    <strong>{item.caseNumber}</strong>：
                    {item.expectedResult || "（预期结果为空）"}
                  </li>
                ))}
              </ul>
              <button
                className="prototype-secondary"
                onClick={onOpenAutomation}
                type="button"
              >
                去自动化用例表补充阈值
              </button>
            </div>
          )}
          {aiSummary.manualItems.length > 0 && (
            <ul className="prototype-ai-manual-list">
              {aiSummary.manualItems.map((item) => (
                <li key={item.caseNumber}>
                  <strong>{item.caseNumber}</strong>：
                  {blockerLabels[item.blocker] ?? "未说明"} · {item.reason}
                  {item.expectedSignal && (
                    <small>（判定信号：{item.expectedSignal}）</small>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {generateError && (
        <div className="prototype-inline-note" role="alert">
          {generateError}
        </div>
      )}
      {generateNotice && (
        <p className="prototype-muted" role="status">
          {generateNotice}
        </p>
      )}

      {source.draft && (
        <V020SourceCaseImportPanel
          draft={source.draft}
          busy={source.busy}
          currentVersionLabel={versionLabel}
          onDraftChange={source.updateDraft}
          onConfirm={() => void source.confirmImport()}
          onCancel={() => source.updateDraft(null)}
        />
      )}

      <V020SourceCaseTable
        items={pageItems}
        selectedIds={source.selectedIds}
        busy={source.busy}
        hasCases={source.totalCount > 0}
        focusCaseId={focusCaseId}
        onToggle={source.toggleSelect}
      />

      {source.items.length > pageSize && (
        <div className="prototype-source-pager" aria-label="用例分页">
          <span>
            第 {currentPage} / {totalPages} 页 · 共 {source.items.length}{" "}
            条，每页 {pageSize} 条
          </span>
          <button
            className="prototype-secondary"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
            type="button"
          >
            上一页
          </button>
          <button
            className="prototype-secondary"
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
            type="button"
          >
            下一页
          </button>
        </div>
      )}

      <V020SourceCaseRecords
        records={source.records}
        deletionImpact={source.deletionImpact}
        busy={source.busy}
        onPreviewDeletion={(importId) => void source.previewDeletion(importId)}
        onCancelDeletion={source.cancelDeletion}
        onConfirmDeletion={() => void source.confirmDeletion()}
      />

      <div className="prototype-inline-note">
        原始用例按产品版本独立保存；删除导入记录时会一并清除该记录下的原始用例，
        以及由它们生成的自动化候选和测试组关联。
        重新导入同一份用例表时，在导入面板勾选“覆盖已有用例”，就不会堆成两份。
      </div>

      <V020AiGenerateDialog
        busy={generatingWithAi}
        missingCount={source.missingAutomationCount}
        onCancel={() => setAiDialogOpen(false)}
        onConfirm={(mode) => void generateAutomationCasesWithAi(mode)}
        open={aiDialogOpen}
        selectedCount={source.selectedIds.length}
        totalCount={source.totalCount}
      />
      {groupNotice && (
        <div className="prototype-inline-note" role="status">
          {groupNotice}
        </div>
      )}

      <V020AddToGroupDialog
        automationIds={[]}

        onClose={() => setShowGroupDialog(false)}
        onDone={(message) => {
          setGroupNotice(message);
          void source.retry();
        }}
        open={showGroupDialog}
        sourceIds={source.selectedIds}
        versionId={versionId}
      />
    </>
  );
}
