import { useEffect, useState } from "react";
import { prototypeReportHistory as reportHistory } from "./V020PrototypeReportData";

type ReportView = "closed" | "history" | "preview";
const reportStatLabels = ["测试用例", "通过", "失败", "阻塞"] as const;

export function PrototypeReportActions({
  selectedGroup,
}: {
  selectedGroup: string;
}) {
  const [view, setView] = useState<ReportView>("closed");
  const [reportId, setReportId] = useState("003");
  const report =
    reportHistory.find((item) => item.id === reportId) ?? reportHistory[0];

  useEffect(() => {
    if (view === "closed") return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setView("closed");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [view]);

  const previewReport = (id: string) => {
    setReportId(id);
    setView("preview");
  };

  return (
    <>
      <div className="prototype-actions">
        <button className="prototype-primary">生成最终报告</button>
        <button
          className="prototype-secondary"
          type="button"
          onClick={() => setView("history")}
        >
          查看报告列表
        </button>
        <button
          className="prototype-secondary"
          type="button"
          onClick={() => previewReport("003")}
        >
          预览最新报告（HTML）
        </button>
        <button className="prototype-secondary">下载纯文字</button>
      </div>

      {view === "history" && (
        <div className="prototype-report-overlay">
          <section
            className="prototype-report-history"
            role="dialog"
            aria-modal="true"
            aria-label="历史报告列表"
          >
            <header className="prototype-report-dialog-head">
              <div>
                <span className="prototype-kicker">REPORT ARCHIVE</span>
                <h2>历史报告</h2>
                <p>{selectedGroup} · 按生成时间倒序排列</p>
              </div>
              <button
                className="prototype-report-close"
                type="button"
                aria-label="关闭报告列表"
                onClick={() => setView("closed")}
              >
                ×
              </button>
            </header>
            <div className="prototype-report-history-list">
              {reportHistory.map((item) => (
                <article key={item.id}>
                  <div>
                    <span className="prototype-report-id">报告 #{item.id}</span>
                    {item.latest && (
                      <span className="prototype-report-latest">最新</span>
                    )}
                    <h3>{item.conclusion}</h3>
                    <p>{item.source}</p>
                  </div>
                  <div className="prototype-report-row-actions">
                    <time>{item.createdAt}</time>
                    <button
                      className="prototype-secondary"
                      type="button"
                      aria-label={`预览报告 #${item.id}`}
                      onClick={() => previewReport(item.id)}
                    >
                      预览 HTML
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {view === "preview" && (
        <div className="prototype-report-overlay prototype-report-overlay--preview">
          <section
            className="prototype-report-html"
            role="dialog"
            aria-modal="true"
            aria-label={
              report.latest
                ? "最新报告 HTML 预览"
                : `报告 #${report.id} HTML 预览`
            }
          >
            <div className="prototype-report-preview-toolbar">
              <button
                className="prototype-secondary"
                type="button"
                aria-label="返回报告列表"
                onClick={() => setView("history")}
              >
                ← 返回报告列表
              </button>
              <span>HTML 报告预览 · 报告 #{report.id}</span>
              <button
                className="prototype-report-close"
                type="button"
                aria-label="关闭报告预览"
                onClick={() => setView("closed")}
              >
                ×
              </button>
            </div>
            <article className="prototype-report-document">
              <header>
                <div>
                  <span className="prototype-kicker">IRIS TEST REPORT</span>
                  <h1>
                    <span>{selectedGroup}</span>
                    <span>最终测试报告</span>
                  </h1>
                  <p>IRIS 头环 · EVT1 · 生成时间 {report.createdAt}</p>
                </div>
                <span className="prototype-report-verdict">
                  {report.verdict}
                </span>
              </header>
              <section className="prototype-report-summary-grid">
                {report.stats.map((value, index) => (
                  <div key={reportStatLabels[index]}>
                    <strong>{value}</strong>
                    <span>{reportStatLabels[index]}</span>
                  </div>
                ))}
              </section>
              <section>
                <h2>测试结论</h2>
                <p>{report.summary}</p>
              </section>
              <section className="prototype-report-findings">
                <h2>需持续跟踪</h2>
                <ul>
                  <li>
                    <strong>TC-REC-002</strong> 异常断电恢复后需复核文件完整性。
                  </li>
                  <li>
                    <strong>TC-PWR-003</strong> 低电量连续采集仍有一次数据缺口。
                  </li>
                  <li>
                    <strong>TC-IMU-004</strong> 长时运行后继续观察时间戳漂移。
                  </li>
                </ul>
              </section>
              <section className="prototype-report-ai-advice">
                <span>AI ASSISTED REVIEW</span>
                <h3>AI 回测建议</h3>
                <p>{report.advice}</p>
              </section>
            </article>
          </section>
        </div>
      )}
    </>
  );
}
