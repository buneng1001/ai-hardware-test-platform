import { useEffect, useMemo, useState } from "react";

import { listSourceTestCases, type SourceTestCase } from "./sourceTestCasesApi";
import {
  addTestGroupSourceCases,
  getTestGroup,
  orderTestGroupCases,
  removeTestGroupSourceCase,
  type TestGroupDetail,
} from "./testGroupsApi";

/** 冻结版测试组原始用例范围：加入、移除和排序都不影响平台级用例。 */
export function V020TestGroupSourceCases({
  detail,
  onChange,
}: {
  detail: TestGroupDetail;
  onChange: (detail: TestGroupDetail) => void;
}) {
  const [available, setAvailable] = useState<SourceTestCase[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void listSourceTestCases(detail.product_version_id, {})
      .then((result) => setAvailable(result.items))
      .catch((caught) =>
        setMessage(
          caught instanceof Error ? caught.message : "原始用例加载失败",
        ),
      );
  }, [detail.product_version_id]);

  const candidates = useMemo(
    () =>
      available.filter(
        (item) =>
          !detail.source_test_cases.some((current) => current.id === item.id),
      ),
    [available, detail.source_test_cases],
  );

  const run = async (
    action: () => Promise<TestGroupDetail | void>,
    success: string,
  ) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (result) onChange(result);
      setMessage(success);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "测试组操作失败");
    } finally {
      setBusy(false);
    }
  };

  const move = (caseId: number, offset: number) => {
    const ids = detail.source_test_cases.map((item) => item.id);
    const from = ids.indexOf(caseId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void run(
      () => orderTestGroupCases(detail.id, "source-test-cases", ids),
      "原始用例排序已保存。",
    );
  };

  return (
    <section aria-label="测试组原始用例范围">
      <h3>原始用例范围</h3>
      {message && (
        <p className="prototype-muted" role="status">
          {message}
        </p>
      )}
      <div className="prototype-filter-row">
        <select
          multiple
          aria-label="加入原始用例"
          value={selectedIds.map(String)}
          onChange={(event) =>
            setSelectedIds(
              Array.from(event.currentTarget.selectedOptions, (option) =>
                Number(option.value),
              ),
            )
          }
        >
          {candidates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.case_number} · {item.title}
            </option>
          ))}
        </select>
        <button
          className="prototype-secondary"
          disabled={busy || selectedIds.length === 0}
          onClick={() =>
            void run(async () => {
              const next = await addTestGroupSourceCases(
                detail.id,
                selectedIds,
              );
              setSelectedIds([]);
              return next;
            }, "已加入原始用例。")
          }
          type="button"
        >
          加入所选原始用例
        </button>
      </div>
      {detail.source_test_cases.length === 0 ? (
        <p className="prototype-muted">当前测试组还没有原始用例。</p>
      ) : (
        <div className="prototype-table-wrap">
          <table className="prototype-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>用例编号</th>
                <th>标题</th>
                <th>类型</th>
                <th>软件版本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {detail.source_test_cases.map((item) => (
                <tr key={item.id}>
                  <td>{item.position}</td>
                  <td>{item.case_number}</td>
                  <td>{item.title}</td>
                  <td>{item.test_type || "未填写"}</td>
                  <td>{item.software_version || "未填写"}</td>
                  <td className="prototype-automation-actions">
                    <button
                      className="prototype-secondary"
                      disabled={busy}
                      onClick={() => move(item.id, -1)}
                      type="button"
                    >
                      上移
                    </button>
                    <button
                      className="prototype-secondary"
                      disabled={busy}
                      onClick={() => move(item.id, 1)}
                      type="button"
                    >
                      下移
                    </button>
                    <button
                      className="prototype-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await removeTestGroupSourceCase(detail.id, item.id);
                          return getTestGroup(detail.id);
                        }, "已从测试组移除；平台级原始用例保留。")
                      }
                      type="button"
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="prototype-inline-note">
        从组内移除不会删除平台级原始用例；加入测试组不复制用例内容。
      </p>
    </section>
  );
}
