import { useEffect, useState } from "react";
import { getFactReport, type FactReport } from "./factReportsApi";
import { V030ReportProgress } from "./V030ReportProgress";

const labels: Record<string, string> = {
  pending: "AI 分析中",
  completed: "AI 分析已完成",
  failed: "AI 分析失败",
  cancelled: "AI 分析已取消",
  not_enabled: "AI 未启用",
};

export function V030ReadOnlyReport({
  id,
  onClose,
}: {
  id: number;
  onClose: () => void;
}) {
  const [report, setReport] = useState<FactReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const result = await getFactReport(id);
        if (result.id !== id || !result.snapshot) throw new Error("报告不存在");
        if (live) {
          setReport(result);
          setError("");
        }
      } catch {
        if (live) setError("报告不可用或加载失败，请重新打开。");
      } finally {
        if (live) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [id]);
  return (
    <div
      className="v030-regression-preview-overlay"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`报告 #${id} 只读预览`}
        className="v030-regression-preview"
      >
        <header>
          <strong>
            最终报告 #{id} ·{" "}
            {report
              ? (labels[report.analysis.status] ?? report.analysis.status)
              : "只读预览"}
          </strong>
          <button
            type="button"
            className="prototype-secondary"
            onClick={onClose}
          >
            关闭报告预览
          </button>
        </header>
        {loading && <p role="status">正在读取报告…</p>}
        {error && <p role="alert">{error}</p>}
        {report && <V030ReportProgress progress={report.analysis.progress} />}
        {report && (
          <iframe
            title={`报告 #${id} HTML`}
            src={`/api/fact-reports/${id}.html`}
            key={`${id}:${report.analysis.status}`}
            sandbox=""
          />
        )}
      </section>
    </div>
  );
}
