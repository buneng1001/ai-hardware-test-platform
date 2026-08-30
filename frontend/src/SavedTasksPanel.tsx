import type { SavedTaskPage } from "./collectionTasksApi";
import type { SavedTaskFilters } from "./appTypes";

type SavedTasksPanelProps = {
  tasks: SavedTaskPage | null;
  error: string | null;
  filters: SavedTaskFilters;
  onFiltersChange: (filters: SavedTaskFilters) => void;
  onRefresh: (page?: number, filters?: SavedTaskFilters) => void;
  onArchive: (taskId: number) => void;
  onDelete: (taskId: number) => void;
};

export function SavedTasksPanel(props: SavedTasksPanelProps) {
  const update = (next: SavedTaskFilters) => {
    props.onFiltersChange(next);
    props.onRefresh(1, next);
  };
  return (
    <section className="task-list" aria-labelledby="saved-task-title">
      <p className="eyebrow">已保存任务</p>
      <h2 id="saved-task-title">任务生命周期</h2>
      <p>列表按来源、执行状态和归档状态提供筛选；每页最多 10 条。</p>
      <div className="configuration-grid" aria-label="已保存任务筛选">
        <label>
          来源
          <select
            value={props.filters.source ?? ""}
            onChange={(e) =>
              update({
                ...props.filters,
                source:
                  (e.target.value as SavedTaskFilters["source"]) || undefined,
              })
            }
          >
            <option value="">全部来源</option>
            <option value="synthetic_generated">合成数据</option>
            <option value="imported_actual_data">导入实际数据</option>
          </select>
        </label>
        <label>
          执行状态
          <select
            value={props.filters.execution_status ?? ""}
            onChange={(e) =>
              update({
                ...props.filters,
                execution_status:
                  (e.target.value as SavedTaskFilters["execution_status"]) ||
                  undefined,
              })
            }
          >
            <option value="">全部执行状态</option>
            <option value="never_executed">未执行</option>
            <option value="has_runs">已有运行</option>
          </select>
        </label>
        <label>
          归档状态
          <select
            value={
              props.filters.archived === undefined
                ? ""
                : String(props.filters.archived)
            }
            onChange={(e) =>
              update({
                ...props.filters,
                archived:
                  e.target.value === "" ? undefined : e.target.value === "true",
              })
            }
          >
            <option value="">全部归档状态</option>
            <option value="false">未归档</option>
            <option value="true">已归档</option>
          </select>
        </label>
      </div>
      <button type="button" onClick={() => props.onRefresh()}>
        刷新已保存任务
      </button>
      {props.error && <p role="alert">{props.error}</p>}
      {props.tasks && (
        <>
          <p>
            第 {props.tasks.page} 页 · 共 {props.tasks.total} 条
          </p>
          {props.tasks.items.map((task) => (
            <article className="task-card" key={task.id}>
              <h3>{task.name}</h3>
              <p>
                来源：
                {task.source === "synthetic_generated"
                  ? "合成数据"
                  : "导入实际数据"}{" "}
                · {task.execution_status === "has_runs" ? "已有运行" : "未执行"}{" "}
                · {task.archived ? "已归档" : "未归档"}
              </p>
              {task.execution_status === "has_runs" ? (
                <button type="button" onClick={() => props.onArchive(task.id)}>
                  归档任务 {task.name}
                </button>
              ) : (
                <button type="button" onClick={() => props.onDelete(task.id)}>
                  删除任务 {task.name}
                </button>
              )}
            </article>
          ))}
          <div className="pagination" aria-label="已保存任务分页">
            <button
              type="button"
              disabled={props.tasks.page <= 1}
              onClick={() => props.onRefresh(props.tasks!.page - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              disabled={
                props.tasks.page * props.tasks.page_size >= props.tasks.total
              }
              onClick={() => props.onRefresh(props.tasks!.page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </section>
  );
}
