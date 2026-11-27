import { useEffect, useRef, useState } from "react";

import { Status } from "./V020PrototypeShared";
import { V020ReportDeleteDialog } from "./V020ReportDeleteDialog";
import { V020ConfirmDialog } from "./V020ConfirmDialog";
import { V020ReportHistoryDialog } from "./V020ReportHistoryDialog";
import { V020ReportPreviewDialog } from "./V020ReportPreviewDialog";
import { useV020FactReports } from "./useV020FactReports";
import { V020ResultBreakdown } from "./V020ResultBreakdown";
import { V030AuxiliaryReportSelector } from "./V030AuxiliaryReportSelector";
import { V030ReadOnlyReport } from "./V030ReadOnlyReport";
import "./V030ReportWorkflow.css";
import { V020ExecutionResultCard } from "./V020ExecutionResultCard";
import { V020ManualResultSummaryCard } from "./V020ManualResultSummaryCard";
import "./V020Reports.css";

type ReportView = "closed" | "generate" | "history" | "preview";

const lifecycleLabels: Record<string, string> = {
  current: "当前在线报告",
  stale: "在线报告已过期",
  superseded: "已被新报告覆盖",
};

type SourceChoice = { automation?: number | null; manual?: number[] };

function readSourceChoice(groupId: number): SourceChoice {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(`v030-report-source-${groupId}`) ?? "{}",
    ) as SourceChoice;
    return {
      automation:
        raw.automation === null ||
        (typeof raw.automation === "number" &&
          Number.isInteger(raw.automation) &&
          raw.automation > 0)
          ? raw.automation
          : undefined,
      manual: Array.isArray(raw.manual)
        ? raw.manual.filter((id) => Number.isInteger(id) && id > 0)
        : undefined,
    };
  } catch {
    return {};
  }
}

/** 冻结版最终报告区：真实在线报告摘要、生成、列表、预览与下载。 */
export function V020ReportPanel({
  groupId,
  groupName,
  onOpenManual,
  reportFocus,
}: {
  groupId: number;
  groupName: string;
  onOpenManual: (group: { id: number; name: string }) => void;
  reportFocus?: {
    reportId: number;
    groupId: number;
    target: "ai" | "regression";
  } | null;
}) {
  const reports = useV020FactReports(groupId);
  const openReportRef = useRef(reports.openReport);
  openReportRef.current = reports.openReport;
  const [focusAiSection, setFocusAiSection] = useState(false);
  useEffect(() => {
    if (!reportFocus) return;
    let live = true;
    void openReportRef.current(reportFocus.reportId).then((opened) => {
      if (!live || !opened) return;
      if (reportFocus.target === "ai") {
        setFocusAiSection(true);
        setView("preview");
      } else {
        setFocusAiSection(false);
        setView("closed");
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const target = document.getElementById(
              `v030-regression-${reportFocus.reportId}`,
            );
            target?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          });
        });
      }
      window.dispatchEvent(
        new CustomEvent("v030-report-focus-consumed", {
          detail: { reportId: reportFocus.reportId },
        }),
      );
    });
    return () => {
      live = false;
    };
  }, [reportFocus?.reportId, reportFocus?.target]);
  const [view, setView] = useState<ReportView>("closed");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // undefined = 默认最新；null/[] = 用户明确选“无”，跨刷新保留。
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(() =>
    readSourceChoice(groupId),
  );
  const [historyIds, setHistoryIds] = useState<number[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [sourcePreview, setSourcePreview] = useState<number | null>(null);
  const updateSourceChoice = (next: SourceChoice) => {
    setSourceChoice(next);
    window.localStorage.setItem(
      `v030-report-source-${groupId}`,
      JSON.stringify(next),
    );
  };
  const selectedExecutionId =
    sourceChoice.automation === undefined
      ? (reports.executions[0]?.id ?? null)
      : sourceChoice.automation;
  const selectedManualIds =
    sourceChoice.manual === undefined
      ? reports.batches.length
        ? [reports.batches[0].id]
        : []
      : sourceChoice.manual;
  const missingSource =
    (selectedExecutionId !== null &&
      !reports.executions.some((item) => item.id === selectedExecutionId)) ||
    selectedManualIds.some(
      (id) => !reports.batches.some((item) => item.id === id),
    ) ||
    historyIds.some(
      (id) => !reports.historicalOptions.some((item) => item.id === id),
    );
  const canGenerate =
    selectedExecutionId !== null ||
    selectedManualIds.length > 0 ||
    historyIds.length > 0;
  const report = reports.report;
  const chosenExecution = reports.executions.find(
    (item) => item.id === selectedExecutionId,
  );
  const chosenBatches = reports.batches.filter((item) =>
    selectedManualIds.includes(item.id),
  );
  const chosenHistory = reports.historicalOptions.filter((item) =>
    historyIds.includes(item.id),
  );

  if (reports.status === "loading" || reports.status === "idle") {
    return (
      <div className="prototype-report-preview">
        <p className="prototype-muted" role="status">
          正在加载最终报告…
        </p>
      </div>
    );
  }

  if (reports.status === "error") {
    return (
      <div className="prototype-report-preview">
        <div className="prototype-inline-note" role="alert">
          最终报告加载失败：{reports.error}
          <button
            className="prototype-secondary"
            onClick={reports.retry}
            type="button"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <h3 className="v030-workflow-title">01 · 最终测试报告</h3>
      <div className="prototype-result-grid v030-result-grid">
        <V020ExecutionResultCard
          records={reports.executions}
          selectedExecutionId={selectedExecutionId}
          onSelectExecution={(id) =>
            updateSourceChoice({ ...sourceChoice, automation: id })
          }
          onRefresh={reports.retry}
          busy={reports.busy}
        />
        <V020ManualResultSummaryCard
          batches={reports.batches}
          selectedBatchIds={selectedManualIds}
          onSelectBatches={(ids) =>
            updateSourceChoice({ ...sourceChoice, manual: ids })
          }
          onOpenManual={() => onOpenManual({ id: groupId, name: groupName })}
          busy={reports.busy}
        />
      </div>
      <div className="prototype-report-source-picker v030-history-source">
        <h4>历史对照报告（可选）</h4>
        <p className="prototype-muted">
          仅用于生成本次最终测试报告，独立对照，不计入当前版本统计。不是智能回归的辅助报告。
        </p>
        <div className="v030-report-tag-list">
          {chosenHistory.map((item) => (
            <span className="v030-regression-tag" key={item.id}>
              <button
                type="button"
                className="v030-report-link"
                onClick={() => setSourcePreview(item.id)}
              >
                报告 #{item.id} · {item.product_version}
              </button>
              <button
                type="button"
                aria-label={`移除历史报告 #${item.id}`}
                onClick={() =>
                  setHistoryIds((ids) => ids.filter((id) => id !== item.id))
                }
              >
                ×
              </button>
            </span>
          ))}
          {!chosenHistory.length && (
            <span className="prototype-muted">不纳入历史对照报告</span>
          )}
          <button
            type="button"
            className="prototype-secondary"
            aria-expanded={historyExpanded}
            onClick={() => setHistoryExpanded((value) => !value)}
          >
            搜索 / 添加历史对照报告
          </button>
        </div>
        {historyExpanded && (
          <div className="v030-regression-results">
            <input
              aria-label="搜索历史对照报告"
              placeholder="搜索报告编号、版本、测试组"
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
            />
            <div
              className="v030-regression-options"
              aria-label="历史最终报告来源"
            >
              {reports.historicalOptions
                .filter(
                  (item) =>
                    !historyIds.includes(item.id) &&
                    `#${item.id} ${item.product_version} ${item.test_group}`
                      .toLowerCase()
                      .includes(historySearch.trim().toLowerCase()),
                )
                .map((item) => (
                  <div className="v030-report-choice" key={item.id}>
                    <button
                      type="button"
                      aria-label={`选择历史报告 #${item.id}`}
                      onClick={() => setHistoryIds((ids) => [...ids, item.id])}
                    >
                      ＋ 报告 #{item.id} · {item.product_version} ·{" "}
                      {item.test_group} ·{" "}
                      {item.created_at.slice(0, 16).replace("T", " ")}
                    </button>
                    <button
                      type="button"
                      className="v030-report-link"
                      onClick={() => setSourcePreview(item.id)}
                    >
                      查看报告 #{item.id}
                    </button>
                  </div>
                ))}
              {!reports.historicalOptions.length && (
                <p className="prototype-muted">
                  当前项目暂无有效历史最终报告。
                </p>
              )}
              {reports.historicalError && (
                <p role="alert">{reports.historicalError}</p>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="v030-report-generation">
        <p className="prototype-muted">
          本次报告来源：自动化 {selectedExecutionId === null ? 0 : 1} 批 · 人工{" "}
          {selectedManualIds.length} 批 · 历史报告 {historyIds.length} 份
        </p>
        {missingSource && (
          <p role="alert">已保存的某项来源现已不可用，请重新选择后再生成。</p>
        )}
        {!canGenerate && (
          <p className="prototype-muted">
            至少需要一项有效事实来源才能生成最终报告。
          </p>
        )}
      </div>
      <div className="prototype-report-preview">
        <div>
          {report ? (
            <Status
              tone={report.lifecycle_status === "current" ? "good" : "warn"}
            >
              {lifecycleLabels[report.lifecycle_status] ??
                report.lifecycle_status}
            </Status>
          ) : (
            <Status tone="warn">尚无在线报告</Status>
          )}
          <h3>
            {groupName}：
            {report
              ? report.snapshot.stage_progress.conclusion
              : "尚未生成最终报告"}
          </h3>
          {report ? (
            <>
              <p>
                报告 #{report.id} · 生成时间{" "}
                {report.snapshot.basic_information.generated_at
                  .slice(0, 16)
                  .replace("T", " ")}{" "}
                · 数据来源：{report.snapshot.basic_information.contains}
              </p>
              {report.snapshot.pass_rate?.overall && (
                <V020ResultBreakdown
                  counts={report.snapshot.pass_rate.overall}
                  label="当前在线事实报告"
                  variant="ring"
                />
              )}
              {report.snapshot.warnings.map((warning) => (
                <p key={warning} role="status">
                  {warning}
                </p>
              ))}
              <p className="prototype-muted">
                {/* 用实时分析状态，快照里的静态标记会一直显示“未配置”。 */}
                AI 区域状态：{report.analysis.status} ·{" "}
                {report.analysis.message}
              </p>
            </>
          ) : (
            <p className="prototype-muted">
              选择自动化、人工批次或有效历史最终报告后生成事实报告；历史报告只作独立对照，不计入当前版本统计。
            </p>
          )}
        </div>
        <div className="prototype-actions">
          <button
            className="prototype-primary"
            disabled={reports.busy || !canGenerate || missingSource}
            onClick={() => setView("generate")}
            type="button"
          >
            生成最终报告
          </button>
          <button
            className="prototype-secondary"
            onClick={() => setView("history")}
            type="button"
          >
            查看报告列表
          </button>
          <button
            className="prototype-secondary"
            disabled={!report}
            onClick={() => {
              void reports.refreshAnalysis().catch(() => undefined);
              setView("preview");
            }}
            type="button"
          >
            预览最新报告（HTML）
          </button>
          {report ? (
            <a
              className="prototype-secondary prototype-report-download"
              download
              href={`/api/fact-reports/${report.id}.txt`}
            >
              下载纯文字
            </a>
          ) : (
            <button className="prototype-secondary" disabled type="button">
              下载纯文字
            </button>
          )}
          {report && (
            <button
              className="prototype-secondary"
              disabled={reports.busy}
              onClick={() => setDeleteConfirm(true)}
              type="button"
            >
              删除在线报告
            </button>
          )}
        </div>
      </div>

      <V030AuxiliaryReportSelector
        key={`${groupId}:${report?.id ?? "none"}`}
        groupId={groupId}
        reportId={report?.id ?? null}
        analysisStatus={report?.analysis.status ?? "missing"}
        mainReport={report}
        onViewMain={() => {
          void reports.refreshAnalysis().catch(() => undefined);
          setView("preview");
        }}
      />

      {sourcePreview !== null && (
        <V030ReadOnlyReport
          id={sourcePreview}
          onClose={() => setSourcePreview(null)}
        />
      )}
      {reports.actionError && (
        <div className="prototype-inline-note" role="alert">
          {reports.actionError}
        </div>
      )}
      {reports.message && (
        <p className="prototype-muted" role="status">
          {reports.message}
        </p>
      )}

      {view === "generate" && (
        <V020ConfirmDialog
          ariaLabel="确认生成最终报告"
          busy={reports.busy}
          confirmLabel="确认生成"
          onCancel={() => setView("closed")}
          onConfirm={() => {
            setView("closed");
            void reports
              .generate(selectedExecutionId, selectedManualIds, historyIds)
              .then((created) => {
                if (created) setView("preview");
              });
          }}
          title="确认生成最终报告"
        >
          <ul>
            <li>
              自动化执行记录：
              {chosenExecution
                ? `#${chosenExecution.execution_number}`
                : "不使用"}
            </li>
            <li>
              人工测试记录：
              {chosenBatches.length
                ? chosenBatches
                    .map((item) => `#${item.batch_number}`)
                    .join("、")
                : "无（不参与）"}
            </li>
            <li>
              历史最终报告：
              {chosenHistory.length
                ? chosenHistory
                    .map((item) => `#${item.id}（${item.product_version}）`)
                    .join("、")
                : "不纳入"}
              （统计独立展示）
            </li>
          </ul>
        </V020ConfirmDialog>
      )}
      {view === "history" && (
        <V020ReportHistoryDialog
          busy={reports.busy}
          groupName={groupName}
          items={reports.history}
          onClose={() => setView("closed")}
          onPreview={(reportId) => {
            void reports.openReport(reportId).then((opened) => {
              if (opened) setView("preview");
            });
          }}
          onQueryChange={reports.setHistoryQuery}
          onSearch={() => void reports.searchHistory()}
          query={reports.historyQuery}
        />
      )}
      {view === "preview" && report && (
        <V020ReportPreviewDialog
          busy={reports.busy}
          cleanupImpact={reports.cleanupImpact}
          groupName={groupName}
          onBack={() => setView("history")}
          onCancelCleanup={reports.cancelCleanup}
          onCancelAnalysis={reports.cancelAnalysis}
          onClose={() => {
            setFocusAiSection(false);
            setView("closed");
          }}
          onConfirmCleanup={() => void reports.confirmCleanup()}
          onPrepareCleanup={() => void reports.prepareCleanup()}
          onRefreshAnalysis={reports.refreshAnalysis}
          onRerunAnalysis={(overwrite, resumeChoice) =>
            void reports.retryAnalysis(true, overwrite, resumeChoice)
          }
          onCheckRepeat={reports.getRepeatInfo}
          onRetryAnalysis={(resumeChoice) =>
            void reports.retryAnalysis(false, false, resumeChoice)
          }
          report={report}
          focusAiSection={focusAiSection}
        />
      )}
      {deleteConfirm && report && (
        <V020ReportDeleteDialog
          busy={reports.busy}
          onCancel={() => setDeleteConfirm(false)}
          onConfirm={() => {
            void reports.deleteReport().then((deleted) => {
              if (deleted) {
                setDeleteConfirm(false);
                setView("closed");
              }
            });
          }}
          reportLabel={`#${report.id}`}
        />
      )}
    </>
  );
}
