import { useState } from "react";

import { Status } from "./V020PrototypeShared";
import { V020ReportDeleteDialog } from "./V020ReportDeleteDialog";
import { V020ConfirmDialog } from "./V020ConfirmDialog";
import { V020ReportHistoryDialog } from "./V020ReportHistoryDialog";
import { V020ReportPreviewDialog } from "./V020ReportPreviewDialog";
import { useV020FactReports } from "./useV020FactReports";
import { V020ResultBreakdown } from "./V020ResultBreakdown";
import { V030AuxiliaryReportSelector } from "./V030AuxiliaryReportSelector";
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
}: {
  groupId: number;
  groupName: string;
  onOpenManual: (group: { id: number; name: string }) => void;
}) {
  const reports = useV020FactReports(groupId);
  const [view, setView] = useState<ReportView>("closed");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // undefined = 默认最新；null/[] = 用户明确选“无”，跨刷新保留。
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(() =>
    readSourceChoice(groupId),
  );
  const [historyIds, setHistoryIds] = useState<number[]>([]);
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
        <details className="prototype-report-source-menu">
          <summary>
            历史最终报告（多选）：
            {historyIds.length ? `已选 ${historyIds.length} 份` : "不纳入"}
          </summary>
          <div
            className="prototype-report-source-options"
            role="group"
            aria-label="历史最终报告来源"
          >
            {reports.historicalOptions.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  aria-label={`选择历史报告 #${item.id}`}
                  checked={historyIds.includes(item.id)}
                  onChange={(event) =>
                    setHistoryIds((current) =>
                      event.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                />
                报告 #{item.id} · {item.product_version} · {item.test_group} ·{" "}
                {item.created_at.slice(0, 16).replace("T", " ")}
              </label>
            ))}
            {!reports.historicalOptions.length && (
              <p className="prototype-muted">
                当前项目暂无可选的有效历史最终报告。
              </p>
            )}
            {reports.historicalError && (
              <p role="alert">{reports.historicalError}</p>
            )}
          </div>
        </details>
        <p className="prototype-muted v030-report-source-note">
          历史报告仅作独立对照，不计入当前版本统计。
        </p>
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
            onClick={() => setView("preview")}
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
      />

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
          onClose={() => setView("closed")}
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
