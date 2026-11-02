import { Status } from "./V020PrototypeShared";
import { V020ReportAnalysisSection } from "./V020ReportAnalysisSection";
import { V020ReportAttachmentSection } from "./V020ReportAttachmentSection";
import type {
  FactReport,
  ReportAttachmentCleanupImpact,
} from "./factReportsApi";

const statusLabels: Record<string, string> = {
  passed: "通过",
  failed: "失败",
  blocked: "阻塞",
  not_executed: "未执行",
};

const lifecycleLabels: Record<string, string> = {
  current: "已生成",
  stale: "已过期",
  superseded: "已覆盖",
};

/** 冻结版报告预览：按固定顺序展示事实报告，并内嵌真实 HTML 与下载入口。 */
export function V020ReportPreviewDialog({
  report,
  groupName,
  busy,
  onBack,
  onClose,
  onRetryAnalysis,
  onRerunAnalysis,
  onRefreshAnalysis,
  cleanupImpact,
  onPrepareCleanup,
  onCancelCleanup,
  onConfirmCleanup,
}: {
  report: FactReport;
  groupName: string;
  busy: boolean;
  onBack: () => void;
  onClose: () => void;
  onRetryAnalysis: () => void;
  onRerunAnalysis: () => void;
  onRefreshAnalysis: () => void;
  cleanupImpact: ReportAttachmentCleanupImpact | null;
  onPrepareCleanup: () => void;
  onCancelCleanup: () => void;
  onConfirmCleanup: () => void;
}) {
  const snapshot = report.snapshot;
  return (
    <div className="prototype-report-overlay prototype-report-overlay--preview">
      <section
        className="prototype-report-html"
        role="dialog"
        aria-modal="true"
        aria-label={`报告 #${report.id} HTML 预览`}
      >
        <div className="prototype-report-preview-toolbar">
          <button
            className="prototype-secondary"
            type="button"
            aria-label="返回报告列表"
            onClick={onBack}
          >
            ← 返回报告列表
          </button>
          <span>
            HTML 报告预览 · 报告 #{report.id} ·{" "}
            {lifecycleLabels[report.lifecycle_status] ??
              report.lifecycle_status}
          </span>
          <button
            className="prototype-report-close"
            type="button"
            aria-label="关闭报告预览"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <article className="prototype-report-document">
          <header>
            <div>
              <span className="prototype-kicker">IRIS TEST REPORT</span>
              <h1>
                <span>{groupName}</span>
                <span>最终测试报告</span>
              </h1>
              <p>
                {snapshot.basic_information.project_name} ·{" "}
                {snapshot.basic_information.product_name} ·{" "}
                {snapshot.basic_information.product_version} · 生成时间{" "}
                {snapshot.basic_information.generated_at.slice(0, 16)}
              </p>
            </div>
            <span className="prototype-report-verdict">
              {snapshot.stage_progress.conclusion}
            </span>
          </header>
          {snapshot.warnings.map((warning) => (
            <p className="prototype-inline-note" key={warning} role="status">
              {warning}
            </p>
          ))}
          {report.lifecycle_status !== "current" && (
            <p className="prototype-inline-note" role="status">
              该在线报告
              {report.lifecycle_status === "stale" ? "已过期" : "已被覆盖"}
              ，仍可查看和下载；系统不会自动改写已生成的事实内容。
            </p>
          )}

          <section>
            <h2>测试基本信息</h2>
            <p>
              数据来源：{snapshot.basic_information.contains} · 自动化执行：
              {snapshot.basic_information.automation_execution
                ? ` #${snapshot.basic_information.automation_execution.execution_number}`
                : " 无"}
              {" · "}人工批次：
              {snapshot.basic_information.manual_batches.length > 0
                ? snapshot.basic_information.manual_batches
                    .map((item) => `#${item.batch_number}`)
                    .join("、")
                : " 无"}
            </p>
          </section>

          <section>
            <h2>总体结论与通过率</h2>
            <p>
              总体通过率：
              <strong>
                {snapshot.pass_rate.overall.rate === null
                  ? "无可统计结果"
                  : `${snapshot.pass_rate.overall.rate}%`}
              </strong>
              （通过 {snapshot.pass_rate.overall.passed} / 已测{" "}
              {snapshot.pass_rate.overall.tested}，共{" "}
              {snapshot.pass_rate.overall.total} 条，未执行{" "}
              {snapshot.pass_rate.overall.not_executed} 条）
            </p>
            <h3>{snapshot.stage_progress.conclusion}</h3>
            <ul>
              {snapshot.stage_progress.basis.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2>模块汇总</h2>
            <div className="prototype-table-wrap">
              <table className="prototype-table">
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>模块</th>
                    <th>用例数</th>
                    <th>通过</th>
                    <th>失败</th>
                    <th>阻塞</th>
                    <th>未执行</th>
                    <th>通过率</th>
                    <th>结论</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.module_summary.map((module, index) => (
                    <tr key={module.name}>
                      <td>{index + 1}</td>
                      <td>{module.name}</td>
                      <td>
                        {Object.values(module.counts).reduce(
                          (total, value) => total + value,
                          0,
                        )}
                      </td>
                      <td>{module.counts.passed ?? 0}</td>
                      <td>{module.counts.failed ?? 0}</td>
                      <td>{module.counts.blocked ?? 0}</td>
                      <td>{module.counts.not_executed ?? 0}</td>
                      <td>
                        {module.pass_rate.rate === null
                          ? "—"
                          : `${module.pass_rate.rate}%`}
                      </td>
                      <td>{module.conclusion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2>未通过用例</h2>
            {snapshot.issues.failed.length === 0 ? (
              <p>没有未通过用例。</p>
            ) : (
              <ul>
                {snapshot.issues.failed.map((item) => (
                  <li key={`${item.case_number}-${item.source}`}>
                    <strong>{item.case_number}</strong> {item.title}（
                    {item.module}）：{item.actual_result}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>阻塞与未执行</h2>
            <p>
              阻塞 {snapshot.issues.blocked.length} 条 · 未执行{" "}
              {snapshot.issues.not_executed.length} 条
            </p>
            <ul>
              {[
                ...snapshot.issues.blocked,
                ...snapshot.issues.not_executed,
              ].map((item) => (
                <li key={`${item.status}-${item.case_number}-${item.source}`}>
                  <strong>{item.case_number}</strong> {item.title}（
                  {statusLabels[item.status] ?? item.status}）：
                  {item.actual_result}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>执行方式通过率</h2>
            <ul>
              <li>
                自动化：
                {snapshot.pass_rate.automation.rate === null
                  ? "无可统计结果"
                  : `${snapshot.pass_rate.automation.rate}%`}
                （通过 {snapshot.pass_rate.automation.passed} / 已测{" "}
                {snapshot.pass_rate.automation.tested}）
              </li>
              <li>
                人工：
                {snapshot.pass_rate.manual.rate === null
                  ? "无可统计结果"
                  : `${snapshot.pass_rate.manual.rate}%`}
                （通过 {snapshot.pass_rate.manual.passed} / 已测{" "}
                {snapshot.pass_rate.manual.tested}）
              </li>
            </ul>
          </section>
          <section>
            <h2>模块详情</h2>
            {snapshot.modules.map((module) => (
              <div className="prototype-report-module" key={module.name}>
                <h3>{module.name}</h3>
                <Status
                  tone={
                    module.conclusion === "存在结果不一致" ? "warn" : "good"
                  }
                >
                  {module.conclusion}
                </Status>
                <ul className="prototype-report-module-records">
                  {module.records.map((record, index) => (
                    <li key={`${record.case_number}-${record.source}-${index}`}>
                      <strong>{record.case_number}</strong> · {record.source} ·{" "}
                      {statusLabels[record.status] ?? record.status}：
                      {record.message}
                      {record.result_consistency && (
                        <em>（{record.result_consistency}）</em>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <V020ReportAnalysisSection
            busy={busy}
            onRefresh={onRefreshAnalysis}
            onRerun={onRerunAnalysis}
            onRetry={onRetryAnalysis}
            report={report}
          />

          <section>
            <h2>附录：跨模块问题</h2>
            {snapshot.cross_module_issues.length === 0 ? (
              <p>无跨模块冲突。</p>
            ) : (
              <ul>
                {snapshot.cross_module_issues.map((item) => (
                  <li key={item.case_number}>
                    <strong>{item.case_number}</strong>：{item.message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <V020ReportAttachmentSection
            busy={busy}
            cleanupImpact={cleanupImpact}
            onCancelCleanup={onCancelCleanup}
            onConfirmCleanup={onConfirmCleanup}
            onPrepareCleanup={onPrepareCleanup}
            report={report}
          />

          <iframe
            title="事实报告 HTML 预览"
            src={`/api/fact-reports/${report.id}.html`}
          />
          <p>
            <a href={`/api/fact-reports/${report.id}.html`} download>
              下载 HTML 报告
            </a>{" "}
            ·{" "}
            <a href={`/api/fact-reports/${report.id}.txt`} download>
              下载纯文字报告
            </a>
          </p>
        </article>
      </section>
    </div>
  );
}
