import { CollectionTaskForm } from "./CollectionTaskForm";
import { ImportTaskPanel } from "./ImportTaskPanel";
import { RunDetail } from "./RunDetail";
import { SavedTasksPanel } from "./SavedTasksPanel";
import { useAppController } from "./useAppController";

export type LegacyDataView = "create" | "import" | "saved" | "run";

/**
 * 把 v0.1.0 的数据生成、导入、任务管理和运行详情原样接进 v0.2.0“测试数据”页。
 * 复用同一个 useAppController，不重写已经做好的采集逻辑。
 */
export function V020LegacyDataTasks({
  view,
  onBack,
  onFinished,
  onOpenRunView,
  onTaskCreated,
}: {
  view: LegacyDataView;
  onBack: () => void;
  onFinished: () => void;
  onOpenRunView: () => void;
  onTaskCreated: () => void;
}) {
  const controller = useAppController();

  /** 创建成功后跳到任务列表，让用户立刻看到刚建的任务，而不是停在表单上。 */
  const submitTask = async (
    command: Parameters<typeof controller.submitTask>[0],
  ) => {
    const created = await controller.submitTask(command);
    if (created) onTaskCreated();
    return created;
  };

  return (
    <section className="prototype-card legacy-data-shell" aria-label="数据任务">
      <div className="legacy-data-head">
        <div>
          <div className="prototype-kicker">v0.1.0 数据任务</div>
          <h3>
            {view === "create"
              ? "新建采集任务"
              : view === "import"
                ? "导入实际测试数据"
                : view === "saved"
                  ? "已保存任务与运行记录"
                  : "运行详情"}
          </h3>
        </div>
        <div className="prototype-actions">
          <button
            className="prototype-secondary"
            onClick={onBack}
            type="button"
          >
            返回数据包列表
          </button>
          <button
            className="prototype-secondary"
            onClick={onFinished}
            type="button"
          >
            刷新数据包
          </button>
        </div>
      </div>

      {view === "create" && (
        <>
          <p className="prototype-muted">
            快速和标准使用固定安全预设；只有自定义模式可以调整视频路数及详细参数。
          </p>
          <CollectionTaskForm
            disabled={controller.tasks === null}
            saving={controller.saving}
            onSubmit={submitTask}
          />
          {controller.formError && <p role="alert">{controller.formError}</p>}
        </>
      )}

      {view === "import" && (
        <>
          <p className="prototype-muted">
            先选择实际测试 ZIP
            并点“导入实际测试文件”；上传成功后“校验导入文件”和“转为标准格式”才会变成可点。
          </p>
          <ImportTaskPanel
            file={controller.importFile}
            record={controller.importRecord}
            name={controller.importName}
            label={controller.importLabel}
            permissionConfirmed={controller.importPermissionConfirmed}
            busy={controller.importBusy}
            message={controller.importMessage}
            onFileChange={(file) => {
              controller.setImportFile(file);
              controller.setImportRecord(null);
              controller.setImportMessage(null);
            }}
            onPermissionChange={controller.setImportPermissionConfirmed}
            onNameChange={controller.setImportName}
            onLabelChange={controller.setImportLabel}
            onUpload={() => void controller.uploadActualData()}
            onValidate={() => void controller.validateActualData()}
            onConvert={() => void controller.showConversionNotice()}
            onCreate={() => void controller.addImportedTask()}
          />
        </>
      )}

      {view === "saved" && (
        <SavedTasksPanel
          taskDetails={controller.tasks}
          executingTaskId={controller.executingTaskId}
          tasks={controller.savedTasks}
          error={controller.savedTaskError}
          filters={controller.savedTaskFilters}
          onFiltersChange={controller.setSavedTaskFilters}
          onRefresh={(page, filters) =>
            void controller.refreshSavedTasks(page, filters)
          }
          onOpenRun={(id) => {
            void controller.openDashboardRun(id).then(() => onOpenRunView());
          }}
          onExecute={(id) => void controller.executeTask(id)}
          onArchive={(id) => void controller.archiveSavedTask(id)}
          onDelete={(id) => void controller.removeSavedTask(id)}
        />
      )}

      {view === "run" &&
        (controller.selectedRun ? (
          <RunDetail
            run={controller.selectedRun}
            onCancel={() => void controller.cancelSelectedRun()}
            onRerun={() => void controller.rerunSelectedRun()}
            onReviewAlignment={(anchors) =>
              void controller.reviewSelectedAlignment(anchors)
            }
            diagnosisMode={controller.diagnosisMode}
            diagnosisProvider={controller.diagnosisProvider}
            diagnosisModel={controller.diagnosisModel}
            temporaryApiKey={controller.temporaryApiKey}
          />
        ) : (
          <p className="prototype-muted">
            还没有选择运行记录。请先在“已保存任务与运行记录”里打开一条运行。
          </p>
        ))}
    </section>
  );
}
