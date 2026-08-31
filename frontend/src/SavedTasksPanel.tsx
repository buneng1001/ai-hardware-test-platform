import type {
  CollectionTask,
  SavedTask,
  SavedTaskPage,
} from "./collectionTasksApi";
import type { SavedTaskFilters } from "./appTypes";

const modeLabels = {
  quick: "快速",
  standard: "标准",
  custom: "自定义",
} as const;
const scenarioLabels = {
  normal: "正常采集",
  video_drop: "单路视频掉帧",
  imu_anomaly: "IMU 异常",
  storage_exhaustion: "存储不足",
  temperature_combination: "温升关联组合故障",
  fixed_offset: "固定偏移",
  linear_drift: "线性漂移",
} as const;

type SavedTasksPanelProps = {
  taskDetails: CollectionTask[] | null;
  executingTaskId: number | null;
  tasks: SavedTaskPage | null;
  error: string | null;
  filters: SavedTaskFilters;
  onFiltersChange: (filters: SavedTaskFilters) => void;
  onRefresh: (page?: number, filters?: SavedTaskFilters) => void;
  onOpenRun: (runId: number) => void;
  onExecute: (taskId: number) => void;
  onArchive: (taskId: number) => void;
  onDelete: (taskId: number) => void;
};

export function SavedTasksPanel(props: SavedTasksPanelProps) {
  const taskById = new Map(
    props.taskDetails?.map((task) => [task.id, task]) ?? [],
  );
  const hasConfiguration = (taskId: number) => {
    const task = taskById.get(taskId);
    return task?.video !== undefined && task.imu !== undefined;
  };
  const displayItems: SavedTask[] = props.tasks
    ? props.tasks.items
    : (props.taskDetails?.map((task) => ({
        id: task.id,
        name: task.name,
        source: task.source ?? "synthetic_generated",
        execution_status: "never_executed",
        archived: task.archived ?? false,
        run_count: 0,
        runs: [],
        created_at: task.created_at,
      })) ?? []);
  const update = (next: SavedTaskFilters) => {
    props.onFiltersChange(next);
    props.onRefresh(1, next);
  };
  return (
    <section className="task-list" aria-labelledby="saved-task-title">
      <p className="eyebrow">已保存任务</p>
      <h2 id="saved-task-title">任务管理</h2>
      <p>
        在同一个列表中查看任务配置、执行状态和生命周期；支持筛选、执行、删除和归档，每页最多
        10 条。
      </p>
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
      <button
        className="secondary-button saved-task-refresh"
        type="button"
        onClick={() => props.onRefresh()}
      >
        刷新已保存任务
      </button>
      {props.error && <p role="alert">{props.error}</p>}
      {props.tasks === null && props.taskDetails === null && (
        <p role="status">正在加载采集任务…</p>
      )}
      {(props.tasks || props.taskDetails) && (
        <>
          {props.tasks && (
            <p>
              第 {props.tasks.page} 页 · 共 {props.tasks.total} 条
            </p>
          )}
          {displayItems.length === 0 && <p>还没有采集任务。</p>}
          <div className="saved-task-grid">
            {displayItems.map((task) => (
              <article className="task-card" key={task.id}>
                <h3>{task.name}</h3>
                <p className="task-status-line">
                  <span
                    className={`task-status-badge ${
                      task.archived
                        ? "task-status-badge--archived"
                        : "task-status-badge--active"
                    }`}
                  >
                    {task.archived ? "已归档" : "未归档"}
                  </span>
                  {task.archived && (
                    <span className="task-archived-note">
                      仅查看和导出，不能执行或删除
                    </span>
                  )}
                </p>
                {taskById.has(task.id) && (
                  <p>
                    {modeLabels[taskById.get(task.id)!.mode]} ·{" "}
                    {scenarioLabels[taskById.get(task.id)!.scenario]} · 草稿
                  </p>
                )}
                {hasConfiguration(task.id) && (
                  <p>
                    配置：{taskById.get(task.id)!.video.channels} 路视频 ·{" "}
                    {taskById.get(task.id)!.video.resolution} ·{" "}
                    {taskById.get(task.id)!.video.fps} FPS · IMU{" "}
                    {taskById.get(task.id)!.imu.sample_rate_hz}Hz · 参考时钟{" "}
                    {taskById.get(task.id)!.reference_channel}
                  </p>
                )}
                <p>
                  来源：
                  {task.source === "synthetic_generated"
                    ? "合成数据"
                    : "导入实际数据"}{" "}
                  ·{" "}
                  {task.execution_status === "has_runs" ? "已有运行" : "未执行"}{" "}
                  · 运行 {task.run_count} 次
                </p>
                <p>
                  创建时间：{new Date(task.created_at).toLocaleString("zh-CN")}
                </p>
                {(task.runs ?? []).length > 0 && (
                  <div className="task-runs">
                    <strong>运行记录</strong>
                    {(task.runs ?? []).map((run) => (
                      <button
                        className="run-link"
                        type="button"
                        key={run.id}
                        onClick={() => props.onOpenRun(run.id)}
                      >
                        运行 #{run.id} · 第 {run.execution_number} 次 ·{" "}
                        {run.status}
                      </button>
                    ))}
                  </div>
                )}
                <div className="task-actions">
                  {taskById.has(task.id) && !task.archived && (
                    <button
                      type="button"
                      disabled={props.executingTaskId !== null}
                      onClick={() => props.onExecute(task.id)}
                    >
                      {props.executingTaskId === task.id
                        ? "正在执行…"
                        : "执行任务"}
                    </button>
                  )}
                  {task.execution_status === "has_runs" && !task.archived ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => props.onArchive(task.id)}
                    >
                      归档任务 {task.name}
                    </button>
                  ) : (
                    !task.archived && (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => props.onDelete(task.id)}
                      >
                        删除任务 {task.name}
                      </button>
                    )
                  )}
                </div>
              </article>
            ))}
          </div>
          {props.tasks && (
            <div className="pagination" aria-label="已保存任务分页">
              <button
                className="secondary-button"
                type="button"
                disabled={props.tasks.page <= 1}
                onClick={() => props.onRefresh(props.tasks!.page - 1)}
              >
                上一页
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={
                  props.tasks.page * props.tasks.page_size >= props.tasks.total
                }
                onClick={() => props.onRefresh(props.tasks!.page + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
