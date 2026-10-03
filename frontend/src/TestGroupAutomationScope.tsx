import { useEffect, useMemo, useState } from "react";

import {
  listAutomationTestCases,
  type AutomationTestCase,
} from "./automationTestCasesApi";
import { listDataPackages, type DataPackage } from "./dataPackagesApi";
import {
  addTestGroupAutomationCases,
  assignDataPackageToCases,
  getTestGroup,
  orderTestGroupCases,
  removeTestGroupAutomationCase,
  replaceTestGroupCasePackages,
  type TestGroupDetail,
} from "./testGroupsApi";

export function TestGroupAutomationScope({
  detail,
  onChange,
}: {
  detail: TestGroupDetail;
  onChange: (detail: TestGroupDetail) => void;
}) {
  const [availableCases, setAvailableCases] = useState<AutomationTestCase[]>(
    [],
  );
  const [packages, setPackages] = useState<DataPackage[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [bulkPackageId, setBulkPackageId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      listAutomationTestCases(detail.product_version_id),
      listDataPackages(),
    ]).then(([cases, dataPackages]) => {
      setAvailableCases(
        cases.items.filter((item) => item.validation_status === "passed"),
      );
      setPackages(
        dataPackages.items.filter(
          (item) => item.validation_status === "passed",
        ),
      );
    });
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
          !detail.automation_test_cases.some(
            (current) => current.id === item.id,
          ),
      ),
    [availableCases, detail.automation_test_cases],
  );
  const move = (id: number, offset: number) => {
    const ids = detail.automation_test_cases.map((item) => item.id);
    const from = ids.indexOf(id);
    const to = from + offset;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void run(
      () => orderTestGroupCases(detail.id, "automation-test-cases", ids),
      "排序已保存。",
    );
  };

  return (
    <section className="test-group-automation-scope">
      {message && <p role="status">{message}</p>}
      <h4>自动化用例与数据包</h4>
      <div className="test-group-candidates">
        <label>
          加入已校验自动化用例
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
              () => addTestGroupAutomationCases(detail.id, selectedIds),
              "已加入自动化用例。",
            )
          }
        >
          加入所选用例
        </button>
      </div>
      <div className="test-group-bulk-package">
        <label>
          批量关联数据包
          <select
            value={bulkPackageId}
            onChange={(event) => setBulkPackageId(event.target.value)}
          >
            <option value="">选择已校验数据包</option>
            {packages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.package_number}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !bulkPackageId || !selectedGroupIds.length}
          onClick={() =>
            void run(
              () =>
                assignDataPackageToCases(
                  detail.id,
                  selectedGroupIds,
                  Number(bulkPackageId),
                ),
              "已批量关联数据包。",
            )
          }
        >
          关联到所选用例
        </button>
      </div>
      {detail.automation_test_cases.length === 0 ? (
        <p>尚无可执行自动化用例。</p>
      ) : (
        <div className="test-group-case-table">
          {detail.automation_test_cases.map((item) => (
            <article key={item.id}>
              <strong>
                {item.position}. {item.case_number} · {item.title}
              </strong>
              <label>
                <input
                  type="checkbox"
                  checked={selectedGroupIds.includes(item.id)}
                  onChange={(event) =>
                    setSelectedGroupIds((current) =>
                      event.target.checked
                        ? [...new Set([...current, item.id])]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                />
                选择 {item.case_number} 用于批量关联
              </label>
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
                    await removeTestGroupAutomationCase(detail.id, item.id);
                    return getTestGroup(detail.id);
                  }, "已从测试组移除；平台级用例保留。")
                }
              >
                移除
              </button>
              <label>
                数据包
                <select
                  multiple
                  aria-label={`${item.case_number} 数据包`}
                  value={item.data_packages.map((dataPackage) =>
                    String(dataPackage.id),
                  )}
                  onChange={(event) =>
                    void run(
                      () =>
                        replaceTestGroupCasePackages(
                          detail.id,
                          item.id,
                          Array.from(
                            event.currentTarget.selectedOptions,
                            (option) => Number(option.value),
                          ),
                        ),
                      "数据包关联已更新。",
                    )
                  }
                >
                  {packages.map((dataPackage) => (
                    <option key={dataPackage.id} value={dataPackage.id}>
                      {dataPackage.package_number}
                    </option>
                  ))}
                </select>
              </label>
              {item.data_packages
                .flatMap((dataPackage) => dataPackage.warnings)
                .map((warning) => (
                  <p className="test-group-warning" key={warning}>
                    {warning}
                  </p>
                ))}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
