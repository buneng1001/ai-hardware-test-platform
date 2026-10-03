import { useEffect, useMemo, useState } from "react";

import { TestGroupAutomationScope } from "./TestGroupAutomationScope";
import { listSourceTestCases, type SourceTestCase } from "./sourceTestCasesApi";
import {
  addTestGroupSourceCases,
  getTestGroup,
  orderTestGroupCases,
  removeTestGroupSourceCase,
  type TestGroupDetail,
} from "./testGroupsApi";

export function TestGroupCasesPanel({
  detail,
  onChange,
}: {
  detail: TestGroupDetail;
  onChange: (detail: TestGroupDetail) => void;
}) {
  const [availableCases, setAvailableCases] = useState<SourceTestCase[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void listSourceTestCases(detail.product_version_id, {}).then((result) =>
      setAvailableCases(result.items),
    );
  }, [detail.id, detail.product_version_id]);

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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试组操作失败");
    } finally {
      setBusy(false);
    }
  };
  const candidates = useMemo(
    () =>
      availableCases.filter(
        (item) =>
          !detail.source_test_cases.some((current) => current.id === item.id),
      ),
    [availableCases, detail.source_test_cases],
  );
  const move = (id: number, offset: number) => {
    const ids = detail.source_test_cases.map((item) => item.id);
    const from = ids.indexOf(id);
    const to = from + offset;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void run(
      () => orderTestGroupCases(detail.id, "source-test-cases", ids),
      "排序已保存。",
    );
  };

  return (
    <>
      {message && <p role="status">{message}</p>}
      <h4>人工/原始用例范围</h4>
      <div className="test-group-candidates">
        <label>
          加入原始用例
          <select
            multiple
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
        </label>
        <button
          type="button"
          disabled={busy || !selectedIds.length}
          onClick={() =>
            void run(
              () => addTestGroupSourceCases(detail.id, selectedIds),
              "已加入原始用例。",
            )
          }
        >
          加入所选原始用例
        </button>
      </div>
      {detail.source_test_cases.length ? (
        <ul>
          {detail.source_test_cases.map((item) => (
            <li key={item.id}>
              {item.position}. {item.case_number} · {item.title}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => move(item.id, -1)}
              >
                上移
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => move(item.id, 1)}
              >
                下移
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await removeTestGroupSourceCase(detail.id, item.id);
                    return getTestGroup(detail.id);
                  }, "已从测试组移除；平台级用例保留。")
                }
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>尚无原始用例。</p>
      )}
      <TestGroupAutomationScope detail={detail} onChange={onChange} />
    </>
  );
}
