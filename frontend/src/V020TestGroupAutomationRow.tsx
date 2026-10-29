import type { DataPackage } from "./dataPackagesApi";
import type { TestGroupDetail } from "./testGroupsApi";

type AutomationCase = TestGroupDetail["automation_test_cases"][number];

/** 冻结版自动化用例行：逐条切换数据包、排序、移除和警告展示。 */
export function V020TestGroupAutomationRow({
  item,
  packages,
  busy,
  checked,
  onCheckedChange,
  onPackagesChange,
  onMove,
  onRemove,
}: {
  item: AutomationCase;
  packages: DataPackage[];
  busy: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onPackagesChange: (packageIds: number[]) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}) {
  return (
    <tr>
      <td>{item.position}</td>
      <td>
        <label>
          <input
            aria-label={`选择 ${item.case_number} 用于批量关联`}
            type="checkbox"
            checked={checked}
            onChange={(event) => onCheckedChange(event.target.checked)}
          />
          {item.case_number}
        </label>
      </td>
      <td>{item.title}</td>
      <td>{item.validation_status === "passed" ? "已校验" : "未校验"}</td>
      <td>{item.source_software_version || "未填写"}</td>
      <td>
        <select
          multiple
          aria-label={`${item.case_number} 数据包`}
          value={item.data_packages.map((entry) => String(entry.id))}
          onChange={(event) =>
            onPackagesChange(
              Array.from(event.currentTarget.selectedOptions, (option) =>
                Number(option.value),
              ),
            )
          }
        >
          {packages.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.package_number}
            </option>
          ))}
        </select>
        {item.data_packages.map((entry) => (
          <div key={entry.id}>
            {entry.validation_status !== "passed" && (
              <p
                className="prototype-row-note prototype-row-note--warning"
                role="alert"
              >
                数据包 {entry.package_number} 未校验，不能执行。
              </p>
            )}
            {entry.warnings.map((warning) => (
              <p
                className="prototype-row-note prototype-row-note--warning"
                key={warning}
              >
                {warning}
              </p>
            ))}
          </div>
        ))}
      </td>
      <td className="prototype-automation-actions">
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={() => onMove(-1)}
          type="button"
        >
          上移
        </button>
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={() => onMove(1)}
          type="button"
        >
          下移
        </button>
        <button
          className="prototype-secondary"
          disabled={busy}
          onClick={onRemove}
          type="button"
        >
          移除
        </button>
      </td>
    </tr>
  );
}
