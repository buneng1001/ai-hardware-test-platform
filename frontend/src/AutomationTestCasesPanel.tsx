import { useEffect, useState } from "react";

import {
  convertSourceTestCasesWithRules,
  listAutomationTestCases,
  type AutomationTestCase,
} from "./automationTestCasesApi";

export function AutomationTestCasesPanel({
  productVersionId,
}: {
  productVersionId: number;
}) {
  const [items, setItems] = useState<AutomationTestCase[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setItems([]);
    setError(null);
    setMessage(null);
    void listAutomationTestCases(productVersionId)
      .then((result) => setItems(result.items))
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "自动化用例加载失败",
        ),
      );
  }, [productVersionId]);

  const convert = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await convertSourceTestCasesWithRules(productVersionId);
      setItems(result.items);
      setMessage(
        result.created_count
          ? `已生成 ${result.created_count} 条规则候选，均需人工审核。`
          : "所有原始用例都已有候选，未覆盖现有可编辑内容。",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "规则转换失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="automation-case-panel"
      aria-labelledby="automation-cases-title"
    >
      <div className="automation-case-heading">
        <div>
          <h3 id="automation-cases-title">自动化用例表</h3>
          <p>规则转换不依赖 AI；所有候选均为低可信度，需人工审核。</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void convert()}>
          规则转换原始用例
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {items.length === 0 ? (
        <p className="workspace-empty">还没有自动化用例候选</p>
      ) : (
        <div className="automation-case-table" role="list">
          {items.map((item) => (
            <article
              className={`automation-case-row automation-case-row--${item.conversion_status}`}
              key={item.id}
              role="listitem"
            >
              <strong>{item.case_number}</strong>
              <a href={`#source-test-case-${item.source_test_case_id}`}>
                {item.source_case_number}
              </a>
              <div>
                <strong>{item.title || "转换失败"}</strong>
                <p>{item.steps}</p>
              </div>
              <span>
                {item.conversion_status === "failed"
                  ? "转换失败"
                  : "低可信度候选"}
              </span>
              <small>{item.review_note}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
