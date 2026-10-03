import { useCallback, useEffect, useState } from "react";

import {
  deleteDataPackage,
  getDataPackage,
  getDataPackageDeletionImpact,
  listDataPackages,
  registerCompletedDataPackages,
  type DataPackage,
  type DataPackageDeletionImpact,
  type DataPackageFilters,
} from "./dataPackagesApi";
import { DataPackageDeletionDialog } from "./DataPackageDeletionDialog";
import { DataPackageDetail } from "./DataPackageDetail";

const emptyFilters: DataPackageFilters = {};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function DataPackagesPanel() {
  const [items, setItems] = useState<DataPackage[]>([]);
  const [filters, setFilters] = useState<DataPackageFilters>(emptyFilters);
  const [selected, setSelected] = useState<DataPackage | null>(null);
  const [impact, setImpact] = useState<DataPackageDeletionImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(
    async (nextFilters = filters) => {
      const result = await listDataPackages(nextFilters);
      setItems(result.items);
    },
    [filters],
  );

  useEffect(() => {
    setSelected(null);
    void load().catch((caught) =>
      setError(errorMessage(caught, "数据包加载失败")),
    );
  }, [load]);

  const updateFilters = (next: DataPackageFilters) => {
    setFilters(next);
    setError(null);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught, "数据包操作失败"));
    } finally {
      setBusy(false);
    }
  };

  const syncCompletedRuns = () =>
    run(async () => {
      await registerCompletedDataPackages();
      await load();
      setMessage("已登记所有已完成的数据任务结果；原始运行记录未被修改。");
    });

  const showDetail = (packageId: number) =>
    run(async () => {
      setSelected(await getDataPackage(packageId));
    });

  const previewDeletion = (packageId: number) =>
    run(async () => {
      setImpact(await getDataPackageDeletionImpact(packageId));
    });

  const confirmDeletion = () =>
    run(async () => {
      if (!impact) return;
      await deleteDataPackage(impact.data_package_id);
      setItems((current) =>
        current.filter((item) => item.id !== impact.data_package_id),
      );
      setSelected((current) =>
        current?.id === impact.data_package_id ? null : current,
      );
      setMessage(
        `${impact.package_number} 已删除；来源任务和 v0.1.0 运行记录仍保留。`,
      );
      setImpact(null);
    });

  return (
    <section
      className="data-package-panel"
      aria-labelledby="data-packages-title"
    >
      <div className="data-package-heading">
        <div>
          <h3 id="data-packages-title">测试数据包</h3>
          <p>只允许已通过完整性校验的数据包在后续测试组中使用。</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void syncCompletedRuns()}
        >
          登记已完成数据任务结果
        </button>
      </div>
      <div className="data-package-filters" aria-label="数据包筛选">
        <label>
          来源
          <select
            value={filters.source_type ?? ""}
            onChange={(event) =>
              updateFilters({
                ...filters,
                source_type: (event.target.value ||
                  undefined) as DataPackageFilters["source_type"],
              })
            }
          >
            <option value="">全部来源</option>
            <option value="generated">平台生成</option>
            <option value="imported">用户导入</option>
          </select>
        </label>
        <label>
          数据属性
          <select
            value={filters.data_kind ?? ""}
            onChange={(event) =>
              updateFilters({
                ...filters,
                data_kind: (event.target.value ||
                  undefined) as DataPackageFilters["data_kind"],
                ...(event.target.value === "fault"
                  ? {}
                  : { fault_type: undefined }),
              })
            }
          >
            <option value="">全部</option>
            <option value="normal">正常数据</option>
            <option value="fault">故障数据</option>
          </select>
        </label>
        <label>
          故障类型
          <select
            disabled={filters.data_kind !== "fault"}
            value={filters.fault_type ?? ""}
            onChange={(event) =>
              updateFilters({
                ...filters,
                fault_type: (event.target.value ||
                  undefined) as DataPackageFilters["fault_type"],
              })
            }
          >
            <option value="">全部故障</option>
            <option value="video_drop">视频掉帧</option>
            <option value="imu_anomaly">IMU 异常</option>
            <option value="storage_exhaustion">存储不足</option>
            <option value="temperature_combination">温度组合</option>
            <option value="fixed_offset">固定偏移</option>
            <option value="linear_drift">线性漂移</option>
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {items.length === 0 ? (
        <p className="workspace-empty">
          尚未登记数据包。请先执行 v0.1.0 数据任务，或登记已有完成结果。
        </p>
      ) : (
        <div className="data-package-list" role="list">
          {items.map((item) => (
            <article
              className="data-package-card"
              key={item.id}
              role="listitem"
            >
              <div>
                <strong>{item.package_number}</strong>
                <span
                  className={
                    item.eligible_for_test_group
                      ? "data-package-status--passed"
                      : "data-package-status--failed"
                  }
                >
                  {item.eligible_for_test_group
                    ? "已校验，可用于测试组"
                    : "未通过校验"}
                </span>
              </div>
              <h4>{item.source_task_name}</h4>
              <p>
                {item.source_type === "generated" ? "平台生成" : "用户导入"} ·{" "}
                {item.data_kind === "normal"
                  ? "正常数据"
                  : `故障数据：${item.fault_type}`}
              </p>
              <p>
                来源运行 #{item.source_run_execution_number} · 指纹{" "}
                {item.version_fingerprint.slice(0, 12)}
              </p>
              {item.has_newer_source_result && (
                <p className="data-package-update">
                  输入源已有更新：推荐运行 #{item.recommended_source_run_id}
                  ，不会自动替换当前包。
                </p>
              )}
              <div className="workspace-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void showDetail(item.id)}
                >
                  查看详情
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void previewDeletion(item.id)}
                >
                  删除数据包
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {selected && <DataPackageDetail item={selected} />}
      {impact && (
        <DataPackageDeletionDialog
          impact={impact}
          busy={busy}
          onCancel={() => setImpact(null)}
          onConfirm={() => void confirmDeletion()}
        />
      )}
    </section>
  );
}
