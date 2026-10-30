import { useState } from "react";

import { Status } from "./V020PrototypeShared";
import { V020ReportGenerateForm } from "./V020ReportGenerateForm";
import { V020ReportHistoryDialog } from "./V020ReportHistoryDialog";
import { V020ReportPreviewDialog } from "./V020ReportPreviewDialog";
import { useV020FactReports } from "./useV020FactReports";
import "./V020Reports.css";

type ReportView = "closed" | "generate" | "history" | "preview";

const lifecycleLabels: Record<string, string> = {
  current: "当前在线报告",
  stale: "在线报告已过期",
  superseded: "已被新报告覆盖",
};

/** 冻结版最终报告区：真实在线报告摘要、生成、列表、预览与下载。 */
export function V020ReportPanel({
  groupId,
  groupName,
}: {
  groupId: number;
  groupName: string;
}) {
  const reports = useV020FactReports(groupId);
  const [view, setView] = useState<ReportView>("closed");
  const report = reports.report;

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
              {report.snapshot.warnings.map((warning) => (
                <p key={warning} role="status">
                  {warning}
                </p>
              ))}
              <p className="prototype-muted">
                AI 区域状态：{report.snapshot.ai_analysis.status} ·{" "}
                {report.snapshot.ai_analysis.message}
              </p>
            </>
          ) : (
            <p className="prototype-muted">
              选择一条自动化执行记录和/或多条人工记录后生成事实报告；失败、阻塞和
              AI 未配置都不会阻止生成。
            </p>
          )}
        </div>
        <div className="prototype-actions">
          <button
            className="prototype-primary"
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
        </div>
      </div>

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
        <V020ReportGenerateForm
          batches={reports.batches}
          busy={reports.busy}
          executions={reports.executions}
          onCancel={() => setView("closed")}
          onGenerate={async (executionId, batchIds) => {
            const created = await reports.generate(executionId, batchIds);
            if (created) setView("preview");
            return created;
          }}
        />
      )}
      {view === "history" && (
        <V020ReportHistoryDialog
          busy={reports.busy}
          groupName={groupName}
          onClose={() => setView("closed")}
          onPreview={(reportId) => {
            void reports.openReport(reportId).then((opened) => {
              if (opened) setView("preview");
            });
          }}
          reports={reports.reports}
        />
      )}
      {view === "preview" && report && (
        <V020ReportPreviewDialog
          busy={reports.busy}
          groupName={groupName}
          onBack={() => setView("history")}
          onClose={() => setView("closed")}
          onRefreshAnalysis={() => void reports.refreshAnalysis()}
          onRetryAnalysis={() => void reports.retryAnalysis()}
          report={report}
        />
      )}
    </>
  );
}
