import { useRef, useState } from "react";

import {
  convertSourceTestCasesWithAi,
  convertSourceTestCasesWithRules,
} from "./automationTestCasesApi";
import { V020CaseTemplatePanel } from "./V020CaseTemplatePanel";
import { V020SourceCaseImportPanel } from "./V020SourceCaseImportPanel";
import { V020SourceCaseRecords } from "./V020SourceCaseRecords";
import { V020SourceCaseTable } from "./V020SourceCaseTable";
import type { SourceCaseFilters } from "./sourceCaseQuery";
import { useV020SourceTestCases } from "./useV020SourceTestCases";
import "./V020SourceCases.css";

const filterControls: Array<[keyof SourceCaseFilters, string, string]> = [
  ["module", "模块筛选", "全部模块"],
  ["test_item", "测试项筛选", "全部测试项"],
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
  onOpenGroups,
  onOpenAutomation,
}: {
  versionId: number | null;
  versionLabel: string;
  focusCaseId: number | null;
  onOpenGroups: () => void;
  onOpenAutomation: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const source = useV020SourceTestCases(versionId);
  const [generating, setGenerating] = useState(false);
  const [generatingWithAi, setGeneratingWithAi] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateNotice, setGenerateNotice] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<{
    automation: number;
    manual: number;
    created: number;
    manualItems: Array<{ caseNumber: string; reason: string }>;
  } | null>(null);

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

  /** AI 转换：把原始用例交给模型，由模型判定哪些可自动化、哪些转人工。 */
  const generateAutomationCasesWithAi = async () => {
    if (versionId === null) return;
    setGeneratingWithAi(true);
    setGenerateError(null);
    setGenerateNotice(null);
    try {
      const result = await convertSourceTestCasesWithAi(
        versionId,
        readTemporaryKey(),
      );
      const manual = result.decisions.filter(
        (item) => item.decision === "manual",
      );
      setAiSummary({
        automation: result.automation_count,
        manual: result.manual_count,
        created: result.created_count,
        manualItems: manual.map((item) => ({
          caseNumber: item.case_number,
          reason: item.reason,
        })),
      });
      if (result.created_count === 0) {
        setGenerateNotice("没有新的原始用例需要 AI 判定；已有候选不会被覆盖。");
      }
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
          当前勾选 {source.selectedIds.length} 条，关闭页面后仍会保留；共
          {source.totalCount} 条原始用例。
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
            onClick={() => void generateAutomationCasesWithAi()}
            type="button"
          >
            {generatingWithAi ? "AI 判定中…" : "AI 生成自动化用例"}
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
            onClick={source.selectAllFiltered}
            type="button"
          >
            全选当前筛选结果
          </button>
          <button
            className="prototype-secondary"
            onClick={source.invertFiltered}
            type="button"
          >
            反选当前筛选结果
          </button>
          <button
            className="prototype-secondary"
            onClick={onOpenGroups}
            type="button"
          >
            加入测试组
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
            <strong>{aiSummary.manual}</strong> 条转人工（已生成{" "}
            {aiSummary.created} 条自动化候选）。
          </p>
          {aiSummary.manualItems.length > 0 && (
            <ul className="prototype-ai-manual-list">
              {aiSummary.manualItems.map((item) => (
                <li key={item.caseNumber}>
                  <strong>{item.caseNumber}</strong>：{item.reason}
                </li>
              ))}
            </ul>
          )}
          <div className="prototype-actions">
            <button
              className="prototype-secondary"
              onClick={onOpenAutomation}
              type="button"
            >
              查看自动化用例表
            </button>
          </div>
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
        items={source.items}
        selectedIds={source.selectedIds}
        busy={source.busy}
        hasCases={source.totalCount > 0}
        focusCaseId={focusCaseId}
        onToggle={source.toggleSelect}
      />

      <V020SourceCaseRecords
        records={source.records}
        deletionImpact={source.deletionImpact}
        busy={source.busy}
        onPreviewDeletion={(importId) => void source.previewDeletion(importId)}
        onCancelDeletion={source.cancelDeletion}
        onConfirmDeletion={() => void source.confirmDeletion()}
      />

      <div className="prototype-inline-note">
        原始用例按产品版本独立保存；导入记录删除后，原始用例保留并标记来源状态，已有自动化用例不会被删除。
      </div>
    </>
  );
}
