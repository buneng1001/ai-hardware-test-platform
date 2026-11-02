import { useEffect, useState } from "react";

import { Status } from "./V020PrototypeShared";
import { V020AutomationExecutionPanel } from "./V020AutomationExecutionPanel";
import { useV020AutomationExecution } from "./useV020AutomationExecution";
import { listDataPackages, type DataPackage } from "./dataPackagesApi";
import {
  assignDataPackageToCases,
  getTestGroup,
  removeTestGroupAutomationCase,
  removeTestGroupSourceCase,
  replaceTestGroupCasePackages,
  type TestGroupDetail,
} from "./testGroupsApi";
import "./V020TestGroupDetail.css";

const pageSize = 20;

type CaseRow = {
  /** 组内用例 id，原始用例和自动化用例各自独立编号空间。 */
  id: number;
  kind: "source" | "automation";
  caseNumber: string;
  title: string;
  testType: string;
  softwareVersion: string;
  position: number;
  packageIds: number[];
  validationStatus?: string;
};

/** 测试组详情：一张用例表，人工与自动化混排，数据包直接在表里选。 */
export function V020TestGroupDetail({
  detail,
  busy,
  onApply,
  onToggleHidden,
  onDelete,
  onBack,
}: {
  detail: TestGroupDetail;
  busy: boolean;
  onApply: (detail: TestGroupDetail) => void;
  onSaveDescription?: (description: string) => void;
  onToggleHidden: () => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [packages, setPackages] = useState<DataPackage[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkPackageId, setBulkPackageId] = useState("");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const execution = useV020AutomationExecution(detail.id);

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

  const rows: CaseRow[] = [
    ...detail.source_test_cases
      .map((item) => ({
        id: item.id,
        kind: "source" as const,
        caseNumber: item.case_number,
        title: item.title,
        testType: item.test_type,
        softwareVersion: item.software_version,
        position: item.position,
        packageIds: [],
      }))
      .sort((left, right) => left.position - right.position),
    ...detail.automation_test_cases
      .map((item) => ({
        id: item.id,
        kind: "automation" as const,
        caseNumber: item.case_number,
        title: item.title,
        testType: "自动化",
        softwareVersion: item.source_software_version,
        position: item.position,
        packageIds: item.data_packages.map((entry) => entry.id),
        validationStatus: item.validation_status,
      }))
      .sort((left, right) => left.position - right.position),
  ];

  // 换测试组后回到第一页
  useEffect(() => {
    setPage(1);
  }, [detail.id]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const rowKey = (row: CaseRow) => `${row.kind}-${row.id}`;
  const toggleRow = (row: CaseRow) => {
    const key = rowKey(row);
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };
  const allSelected =
    pageRows.length > 0 &&
    pageRows.every((row) => selectedKeys.includes(rowKey(row)));

  /** 统一刷新测试组详情，让界面立刻反映后端结果。 */
  const refresh = async () => {
    const next = await getTestGroup(detail.id);
    onApply(next);
    return next;
  };

  const runAction = async (action: () => Promise<void>, success: string) => {
    setWorking(true);
    setMessage(null);
    try {
      await action();
      await refresh();
      setMessage(success);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setWorking(false);
    }
  };

  /** 把选中的数据包分配给勾选的自动化用例；没勾选就分配给全部自动化用例。 */
  const assignPackage = async () => {
    if (!bulkPackageId) return;
    const selectedAutomation = rows
      .filter(
        (row) =>
          row.kind === "automation" &&
          (selectedKeys.includes(rowKey(row)) || selectedKeys.length === 0),
      )
      .map((row) => row.id);
    if (selectedAutomation.length === 0) {
      setMessage("测试组里还没有自动化用例。");
      return;
    }
    await runAction(
      async () => {
        await assignDataPackageToCases(
          detail.id,
          selectedAutomation,
          Number(bulkPackageId),
        );
      },
      selectedKeys.length > 0
        ? "已把数据包分配给勾选的自动化用例。"
        : "已把数据包分配给全部自动化用例。",
    );
  };

  return (
    <section
      aria-label={`${detail.name} 测试组详情`}
      className="prototype-card test-group-detail-card"
    >
      <div className="prototype-group-head">
        <div>
          <strong>{detail.name}</strong>
          <p>
            人工 {detail.source_test_case_count} 条 · 自动化{" "}
            {detail.automation_test_case_count} 条 · 已分配数据包{" "}
            {detail.data_package_assignment_count} 条
          </p>
        </div>
        <Status tone={detail.hidden ? "normal" : "good"}>
          {detail.hidden ? "已隐藏" : "显示中"}
        </Status>
      </div>

      <div className="prototype-actions test-group-topbar">
        <button
          className="prototype-primary"
          disabled={execution.busy || execution.status !== "ready"}
          onClick={() => void execution.run()}
          type="button"
        >
          {execution.busy ? "执行中…" : "执行自动化测试"}
        </button>
        <button
          className="prototype-secondary"
          disabled={!execution.busy}
          onClick={() => execution.cancelRun()}
          type="button"
        >
          取消本次测试
        </button>
        <button
          className="prototype-secondary"
          disabled={busy || working}
          onClick={onToggleHidden}
          type="button"
        >
          {detail.hidden ? "恢复显示" : "隐藏"}
        </button>
        <button
          className="prototype-secondary"
          disabled={busy || working}
          onClick={onDelete}
          type="button"
        >
          删除测试组
        </button>
        <button className="prototype-secondary" onClick={onBack} type="button">
          返回设置列表
        </button>
      </div>

      {message && (
        <p className="prototype-muted" role="status">
          {message}
        </p>
      )}

      <div className="test-group-bulk">
        <span>数据包：</span>
        <select
          aria-label="批量数据包"
          disabled={working}
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
          disabled={working || !bulkPackageId}
          onClick={() => void assignPackage()}
          type="button"
        >
          {selectedKeys.length > 0
            ? `分配给勾选的 ${selectedKeys.length} 条`
            : "分配给全部自动化用例"}
        </button>
      </div>

      <div className="prototype-table-wrap">
        <table className="prototype-table test-group-case-table">
          <thead>
            <tr>
              <th>
                <input
                  aria-label="全选当前页用例"
                  checked={allSelected}
                  onChange={() =>
                    setSelectedKeys(
                      allSelected
                        ? selectedKeys.filter(
                            (key) =>
                              !pageRows.some((row) => rowKey(row) === key),
                          )
                        : [
                            ...new Set([
                              ...selectedKeys,
                              ...pageRows.map((row) => rowKey(row)),
                            ]),
                          ],
                    )
                  }
                  type="checkbox"
                />
              </th>
              <th>序号</th>
              <th>用例编号</th>
              <th>标题</th>
              <th>类型</th>
              <th>测试类型</th>
              <th>软件版本</th>
              <th>数据包</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, index) => (
              <tr key={rowKey(row)}>
                <td>
                  <input
                    aria-label={`选择用例 ${row.caseNumber}`}
                    checked={selectedKeys.includes(rowKey(row))}
                    onChange={() => toggleRow(row)}
                    type="checkbox"
                  />
                </td>
                <td>{(currentPage - 1) * pageSize + index + 1}</td>
                <td>{row.caseNumber}</td>
                <td>{row.title}</td>
                <td>
                  <span
                    className={
                      row.kind === "automation"
                        ? "prototype-type-badge prototype-type-automation"
                        : "prototype-type-badge prototype-type-manual"
                    }
                  >
                    {row.kind === "automation" ? "自动化" : "人工"}
                  </span>
                </td>
                <td>{row.testType || "未填写"}</td>
                <td>{row.softwareVersion || "未填写"}</td>
                <td>
                  {row.kind === "automation" ? (
                    <select
                      aria-label={`${row.caseNumber} 数据包`}
                      disabled={working || rowBusy === rowKey(row)}
                      onChange={(event) =>
                        void runAction(async () => {
                          await replaceTestGroupCasePackages(
                            detail.id,
                            row.id,
                            event.target.value
                              ? [Number(event.target.value)]
                              : [],
                          );
                        }, "数据包已更新。")
                      }
                      value={row.packageIds[0] ? String(row.packageIds[0]) : ""}
                    >
                      <option value="">未分配</option>
                      {packages.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.package_number}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="prototype-muted">—</span>
                  )}
                </td>
                <td>
                  <button
                    className="prototype-secondary"
                    disabled={working}
                    onClick={() =>
                      void runAction(async () => {
                        if (row.kind === "automation") {
                          await removeTestGroupAutomationCase(
                            detail.id,
                            row.id,
                          );
                        } else {
                          await removeTestGroupSourceCase(detail.id, row.id);
                        }
                      }, "已从测试组移除。")
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

      {rows.length > pageSize && (
        <div className="prototype-source-pager" aria-label="测试组用例分页">
          <span>
            第 {currentPage} / {totalPages} 页 · 共 {rows.length} 条，每页{" "}
            {pageSize} 条
          </span>
          <button
            className="prototype-secondary"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
            type="button"
          >
            上一页
          </button>
          <button
            className="prototype-secondary"
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
            type="button"
          >
            下一页
          </button>
        </div>
      )}

      <V020AutomationExecutionPanel execution={execution} />
    </section>
  );
}
