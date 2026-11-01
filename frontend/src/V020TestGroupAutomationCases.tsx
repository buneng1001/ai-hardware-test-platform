import { useEffect, useState } from "react";

import { listDataPackages, type DataPackage } from "./dataPackagesApi";
import { V020TestGroupAutomationRow } from "./V020TestGroupAutomationRow";
import {
  assignDataPackageToCases,
  getTestGroup,
  orderTestGroupCases,
  removeTestGroupAutomationCase,
  replaceTestGroupCasePackages,
  type TestGroupDetail,
} from "./testGroupsApi";

/**
 * 测试组里的自动化用例与数据包。
 * 用例从哪里加入由“自动化用例表 → 加入测试组”负责，这里只做范围管理与数据包分配。
 */
export function V020TestGroupAutomationCases({
  detail,
  onChange,
}: {
  detail: TestGroupDetail;
  onChange: (detail: TestGroupDetail) => void;
}) {
  const [packages, setPackages] = useState<DataPackage[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [bulkPackageId, setBulkPackageId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void listDataPackages()
      .then((loaded) =>
        setPackages(
          loaded.items.filter((item) => item.validation_status === "passed"),
        ),
      )
      .catch((caught) =>
        setMessage(caught instanceof Error ? caught.message : "数据包加载失败"),
      );
  }, []);

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

  /** 有勾选就分配给勾选行，没有勾选就分配给全部用例（先全量默认，再局部微调）。 */
  const assignPackage = async () => {
    if (!bulkPackageId) return;
    const targetIds =
      selectedGroupIds.length > 0
        ? selectedGroupIds
        : detail.automation_test_cases.map((item) => item.id);
    if (targetIds.length === 0) {
      setMessage("测试组里还没有自动化用例。");
      return;
    }
    await run(
      () =>
        assignDataPackageToCases(detail.id, targetIds, Number(bulkPackageId)),
      selectedGroupIds.length > 0
        ? "已把数据包分配给勾选的用例。"
        : "已把数据包分配给全部自动化用例。",
    );
  };

  return (
    <section
      aria-label="测试组自动化用例与数据包"
      id="test-group-automation-scope"
    >
      <h3>自动化用例与数据包</h3>
      <p className="prototype-muted">
        这里管理本次测试的自动化范围：勾选行可把同一个数据包批量分配给它们，不勾选则分配给全部用例；
        单条想换数据包，直接改表格最后一列的下拉。需要加更多用例，到“自动化用例表”勾选后点“加入测试组”。
      </p>
      {message && (
        <p className="prototype-muted" role="status">
          {message}
        </p>
      )}

      <div className="prototype-filter-row">
        <select
          aria-label="批量数据包"
          onChange={(event) => setBulkPackageId(event.target.value)}
          value={bulkPackageId}
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
          disabled={busy || !bulkPackageId}
          onClick={() => void assignPackage()}
          type="button"
        >
          {selectedGroupIds.length > 0
            ? `分配给已勾选的 ${selectedGroupIds.length} 条`
            : "分配给全部用例"}
        </button>
        {selectedGroupIds.length > 0 && (
          <button
            className="prototype-secondary"
            disabled={busy}
            onClick={() => setSelectedGroupIds([])}
            type="button"
          >
            取消勾选
          </button>
        )}
      </div>

      {detail.automation_test_cases.length === 0 ? (
        <p className="prototype-muted">
          测试组里还没有自动化用例。到“自动化用例表”勾选用例后点“加入测试组”即可。
        </p>
      ) : (
        <div className="prototype-table-wrap">
          <table className="prototype-table">
            <thead>
              <tr>
                <th>选择</th>
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
