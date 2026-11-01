import { useEffect, useState } from "react";

import { V020DataPackageCard } from "./V020DataPackageCard";
import { V020DataPackageDeletionDialog } from "./V020DataPackageDeletionDialog";
import { V020DataPackageDetail } from "./V020DataPackageDetail";
import {
  V020LegacyDataTasks,
  type LegacyDataView,
} from "./V020LegacyDataTasks";
import type { DataPackageFilters } from "./dataPackagesApi";
import { useV020DataPackages } from "./useV020DataPackages";
import { faultTypeLabels } from "./v020DataPackageLabels";
import { isTerminalRun } from "./RunDetail";
import { executeCollectionTask, getRun } from "./collectionTasksApi";
import "./V020DataPackages.css";

const faultOptions = Object.entries(faultTypeLabels);
const pageSize = 20;

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
  const [page, setPage] = useState(1);
  const [legacyView, setLegacyView] = useState<LegacyDataView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 一键生成：创建任务后自动执行、等待运行完成并登记为数据包，
   * 用户不需要再手动点“执行”和“登记”。
   */
  const generateFromTask = async (taskId: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      setNotice("任务已创建，正在生成数据…");
      setLegacyView("saved");
      const run = await executeCollectionTask(taskId);
      let current = run;
      const deadline = Date.now() + 120_000;
      while (!isTerminalRun(current.status) && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1500);
        });
        current = await getRun(run.id);
      }
      if (!isTerminalRun(current.status)) {
        setNotice("数据仍在生成中，稍后点“刷新数据包”即可看到结果。");
        return;
      }
      if (current.status !== "completed") {
        setNotice(`数据生成未成功（${current.status}），可打开运行详情查看原因。`);
        return;
      }
      await data.registerCompleted();
      setNotice("数据包已生成并登记，见上方数据包列表。");
    } catch (error) {
      setNotice(
        `生成数据失败：${error instanceof Error ? error.message : "未知原因"}`,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // 数据包同样每页最多 20 个；筛选结果变化后回到第一页。
  const totalPages = Math.max(
    1,
    Math.ceil(data.visibleItems.length / pageSize),
  );
  const currentPage = Math.min(page, totalPages);
  const pageItems = data.visibleItems.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  useEffect(() => {
    setPage(1);
  }, [data.visibleItems]);

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
      <p className="prototype-muted">
        路径：新建任务 → 执行任务 → 刷新数据包 →
        登记为数据包。任务创建成功不代表数据包已生成，
        执行完成并登记后才会出现在下面的列表里。
      </p>
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
          <>
            <div className="prototype-data-grid">
              {pageItems.map((item) => (
                <V020DataPackageCard
                  busy={data.busy}
                  item={item}
                  key={item.id}
                  onDelete={() => void data.previewDeletion(item.id)}
                  onDetail={() => void data.showDetail(item.id)}
                />
              ))}
            </div>
            {data.visibleItems.length > pageSize && (
              <div className="prototype-source-pager" aria-label="数据包分页">
                <span>
                  第 {currentPage} / {totalPages} 页 · 共{" "}
                  {data.visibleItems.length} 个，每页 {pageSize} 个
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
          </>
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
          onClick={() => setLegacyView("create")}
          type="button"
        >
          生成新的数据包
        </button>
        <button
          className="prototype-secondary"
          onClick={() => setLegacyView("import")}
          type="button"
        >
          导入数据并校验
        </button>
        <button
          className="prototype-secondary"
          onClick={() => setLegacyView("saved")}
          type="button"
        >
          执行/刷新数据任务
        </button>
      </div>

      {legacyView && (
        <V020LegacyDataTasks
          onBack={() => setLegacyView(null)}
          onFinished={() => {
            void data.retry();
            setNotice(
              "已刷新数据包列表。执行完成的任务需要先登记，才会出现在数据包列表。",
            );
          }}
          onOpenRunView={() => setLegacyView("run")}
          onTaskCreated={generateFromTask}
          view={legacyView}
        />
      )}

      {notice && (
        <div className="prototype-inline-note" aria-live="polite">
          {notice}
        </div>
      )}

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
