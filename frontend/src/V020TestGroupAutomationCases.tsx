import { useEffect, useMemo, useState } from "react";

import {
  listAutomationTestCases,
  type AutomationTestCase,
} from "./automationTestCasesApi";
import { listDataPackages, type DataPackage } from "./dataPackagesApi";
import { V020TestGroupAutomationRow } from "./V020TestGroupAutomationRow";
import {
  addTestGroupAutomationCases,
  assignDataPackageToCases,
  getTestGroup,
  orderTestGroupCases,
  removeTestGroupAutomationCase,
  replaceTestGroupCasePackages,
  type TestGroupDetail,
} from "./testGroupsApi";

/** 冻结版测试组自动化范围：只允许已校验用例，数据包与用例多对多。 */
export function V020TestGroupAutomationCases({
  detail,
  onChange,
}: {
  detail: TestGroupDetail;
  onChange: (detail: TestGroupDetail) => void;
}) {
  const [available, setAvailable] = useState<AutomationTestCase[]>([]);
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
    ])
      .then(([cases, loadedPackages]) => {
        setAvailable(
          cases.items.filter((item) => item.validation_status === "passed"),
        );
        setPackages(
          loadedPackages.items.filter(
            (item) => item.validation_status === "passed",
          ),
        );
      })
      .catch((caught) =>
        setMessage(
          caught instanceof Error ? caught.message : "自动化用例加载失败",
        ),
      );
  }, [detail.product_version_id]);

  const candidates = useMemo(
    () =>
      available.filter(
        (item) =>
          !detail.automation_test_cases.some(
            (current) => current.id === item.id,
          ),
      ),
    [available, detail.automation_test_cases],
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
    const ids = detail.automation_test_cases.map((item) => item.id);
    const from = ids.indexOf(caseId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void run(
      () => orderTestGroupCases(detail.id, "automation-test-cases", ids),
      "自动化用例排序已保存。",
    );
  };

  return (
    <section
      aria-label="测试组自动化用例与数据包"
      id="test-group-automation-scope"
    >
      <h3>自动化用例与数据包</h3>
      {message && (
        <p className="prototype-muted" role="status">
          {message}
        </p>
      )}
      <div className="prototype-filter-row">
        <select
          multiple
          aria-label="加入已校验自动化用例"
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
              const next = await addTestGroupAutomationCases(
                detail.id,
                selectedIds,
              );
              setSelectedIds([]);
              return next;
            }, "已加入已校验自动化用例。")
          }
          type="button"
        >
          加入所选用例
        </button>
      </div>
      <div className="prototype-filter-row">
        <select
          aria-label="批量关联数据包"
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
        <button
          className="prototype-secondary"
          disabled={busy || !bulkPackageId || selectedGroupIds.length === 0}
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
          type="button"
        >
          关联到所选用例
        </button>
      </div>
      {detail.automation_test_cases.length === 0 ? (
        <p className="prototype-muted">当前测试组还没有已校验自动化用例。</p>
      ) : (
        <div className="prototype-table-wrap">
          <table className="prototype-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>用例编号</th>
                <th>标题</th>
                <th>校验</th>
                <th>软件版本</th>
                <th>数据包</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {detail.automation_test_cases.map((item) => (
                <V020TestGroupAutomationRow
                  busy={busy}
                  checked={selectedGroupIds.includes(item.id)}
                  item={item}
                  key={item.id}
                  onCheckedChange={(checked) =>
                    setSelectedGroupIds((current) =>
                      checked
                        ? [...new Set([...current, item.id])]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                  onMove={(offset) => move(item.id, offset)}
                  onPackagesChange={(packageIds) =>
                    void run(
                      () =>
                        replaceTestGroupCasePackages(
                          detail.id,
                          item.id,
                          packageIds,
                        ),
                      "数据包关联已更新。",
                    )
                  }
                  onRemove={() =>
                    void run(async () => {
                      await removeTestGroupAutomationCase(detail.id, item.id);
                      return getTestGroup(detail.id);
                    }, "已从测试组移除；平台级自动化用例保留。")
                  }
                  packages={packages}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="prototype-inline-note">
        同一数据包可被多个用例和测试组复用；取消一条关联不影响其他关系。输入源更新只提示，不自动替换已选择的数据包。
      </p>
    </section>
  );
}
