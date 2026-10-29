import { V020DataPackageCard } from "./V020DataPackageCard";
import { V020DataPackageDeletionDialog } from "./V020DataPackageDeletionDialog";
import { V020DataPackageDetail } from "./V020DataPackageDetail";
import type { DataPackageFilters } from "./dataPackagesApi";
import { useV020DataPackages } from "./useV020DataPackages";
import { faultTypeLabels } from "./v020DataPackageLabels";
import "./V020DataPackages.css";

const faultOptions = Object.entries(faultTypeLabels);

/**
 * 冻结版“测试数据”页：读取真实数据包，支持筛选、详情、更新提示、
 * 登记历史结果和删除影响确认。
 */
export function V020DataPackagesScreen({
  onNavigate,
}: {
  onNavigate: (page: "new-task" | "import" | "saved") => void;
}) {
  const data = useV020DataPackages();

  const changeKind = (value: string) => {
    const kind = (value || undefined) as DataPackageFilters["data_kind"];
    void data.updateFilters({
      ...data.filters,
      data_kind: kind,
      ...(kind === "fault" ? {} : { fault_type: undefined }),
    });
  };

  return (
    <>
      <div className="prototype-kicker">第 2 步 / 数据任务</div>
      <h2>生成或导入测试数据</h2>
      <div className="prototype-filter-row prototype-data-toolbar">
        <input
          aria-label="搜索数据包"
          placeholder="搜索数据编号或来源任务"
          value={data.search}
          onChange={(event) => data.setSearch(event.target.value)}
        />
        <select
          aria-label="数据来源"
          value={data.filters.source_type ?? ""}
          onChange={(event) =>
            void data.updateFilters({
              ...data.filters,
              source_type: (event.target.value ||
                undefined) as DataPackageFilters["source_type"],
            })
          }
        >
          <option value="">全部来源</option>
          <option value="generated">平台生成</option>
          <option value="imported">用户导入</option>
        </select>
        <select
          aria-label="数据属性"
          value={data.filters.data_kind ?? ""}
          onChange={(event) => changeKind(event.target.value)}
        >
          <option value="">全部数据</option>
          <option value="normal">正常数据</option>
          <option value="fault">故障数据</option>
        </select>
        <select
          aria-label="故障类型"
          disabled={data.filters.data_kind !== "fault"}
          value={data.filters.fault_type ?? ""}
          onChange={(event) =>
            void data.updateFilters({
              ...data.filters,
              fault_type: (event.target.value ||
                undefined) as DataPackageFilters["fault_type"],
            })
          }
        >
          <option value="">全部故障</option>
          {faultOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {data.status === "error" && (
        <div className="prototype-inline-note" role="alert">
          数据包加载失败：{data.error}
          <button
            className="prototype-secondary"
            onClick={data.retry}
            type="button"
          >
            重试
          </button>
        </div>
      )}
      {data.status === "loading" && (
        <p className="prototype-muted" role="status">
          正在加载数据包…
        </p>
      )}
      {data.status === "ready" &&
        (data.visibleItems.length === 0 ? (
          <div className="prototype-card">
            <h3>
              {data.items.length === 0
                ? "还没有已登记的数据包"
                : "没有符合搜索条件的数据包"}
            </h3>
            <p className="prototype-muted">
              {data.items.length === 0
                ? "请先执行 v0.1.0 数据任务，或在下方登记已有完成结果。"
                : "调整编号或来源任务名关键词后再试。"}
            </p>
          </div>
        ) : (
          <div className="prototype-data-grid">
            {data.visibleItems.map((item) => (
              <V020DataPackageCard
                busy={data.busy}
                item={item}
                key={item.id}
                onDelete={() => void data.previewDeletion(item.id)}
                onDetail={() => void data.showDetail(item.id)}
              />
            ))}
          </div>
        ))}

      <div className="prototype-actions">
        <button
          disabled={data.busy}
          onClick={() => void data.registerCompleted()}
          type="button"
        >
          登记已完成数据任务结果
        </button>
        <button
          className="prototype-secondary"
          onClick={() => onNavigate("new-task")}
          type="button"
        >
          生成新的数据包
        </button>
        <button
          className="prototype-secondary"
          onClick={() => onNavigate("import")}
          type="button"
        >
          导入数据并校验
        </button>
        <button
          className="prototype-secondary"
          onClick={() => onNavigate("saved")}
          type="button"
        >
          执行/刷新数据任务
        </button>
      </div>

      {data.actionError && (
        <div className="prototype-inline-note" role="alert">
          {data.actionError}
        </div>
      )}
      {data.message && (
        <p className="prototype-muted" role="status">
          {data.message}
        </p>
      )}

      {data.selected && (
        <V020DataPackageDetail
          item={data.selected}
          onClose={data.closeDetail}
        />
      )}
      {data.impact && (
        <V020DataPackageDeletionDialog
          impact={data.impact}
          busy={data.busy}
          onCancel={data.cancelDeletion}
          onConfirm={() => void data.confirmDeletion()}
        />
      )}

      <div className="prototype-legacy-tools">
        <strong>v0.1.0 数据能力</strong>
        <span>
          新建任务、根据导入生成、已保存任务和运行详情继续作为本模块内部能力接入。
        </span>
      </div>
      <div className="prototype-inline-note">
        测试组只能选择这里已经校验过的数据包。
      </div>
    </>
  );
}
