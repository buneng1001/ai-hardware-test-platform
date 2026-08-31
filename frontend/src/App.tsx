import { useEffect, useState } from "react";
import {
  type AiSettings,
  type CollectionTask,
  type CollectionTaskCommand,
  type DiagnosisMode,
  type DiagnosisProvider,
  type ImportRecord,
  type RunRecord,
  type SavedTaskPage,
  archiveCollectionTask,
  cancelRun,
  convertImport,
  createCollectionTask,
  createImportedTask,
  deleteCollectionTask,
  executeCollectionTask,
  getAiSettings,
  getRun,
  listCollectionTasks,
  listSavedTasks,
  rerun,
  reviewAlignment,
  testAiConnection,
  uploadImport,
  validateImport,
} from "./collectionTasksApi";
import { CollectionTaskForm } from "./CollectionTaskForm";
import { DashboardPanel } from "./DashboardPanel";
import { isTerminalRun, RunDetail } from "./RunDetail";
import { ImportTaskPanel } from "./ImportTaskPanel";
import { Navigation } from "./Navigation";
import { SavedTasksPanel } from "./SavedTasksPanel";
import { SettingsPanel } from "./SettingsPanel";
import type { PageKey, SavedTaskFilters } from "./appTypes";

type Health = { status: "ok"; database: "ok" };
type PageState = Health | "loading" | "unavailable";

import { useAppController } from "./useAppController";

export function App() {
  const {
    state,
    tasks,
    saving,
    formError,
    executingTaskId,
    selectedRun,
    runError,
    activePage,
    diagnosisMode,
    diagnosisProvider,
    diagnosisModel,
    temporaryApiKey,
    connectionMessage,
    testingConnection,
    backendSettings,
    savedTasks,
    savedTaskError,
    savedTaskFilters,
    importFile,
    importRecord,
    importName,
    importLabel,
    importPermissionConfirmed,
    importBusy,
    importMessage,
    submitTask,
    executeTask,
    cancelSelectedRun,
    rerunSelectedRun,
    reviewSelectedAlignment,
    openDashboardRun,
    refreshSavedTasks,
    removeSavedTask,
    archiveSavedTask,
    uploadActualData,
    validateActualData,
    showConversionNotice,
    addImportedTask,
    checkAiConnection,
    testLocalAiConnection,
    clearAiSessionState,
    visible,
    navigate,
    setImportFile,
    setImportRecord,
    setImportMessage,
    setImportPermissionConfirmed,
    setImportName,
    setImportLabel,
    setDiagnosisMode,
    setDiagnosisProvider,
    setDiagnosisModel,
    setTemporaryApiKey,
    setSavedTaskFilters,
  } = useAppController();
  const settingsVisible =
    activePage === "dashboard" || activePage === "settings";
  return (
    <main className="status-page">
      <Navigation activePage={activePage} onNavigate={navigate} />
      <div className="hero-layout">
        <div className="hero-copy">
          <p className="eyebrow">本地运行基线</p>
          <h1>
            <span>智能硬件</span>
            <span>测试执行与诊断平台</span>
          </h1>
          {state === "loading" && <p role="status">正在检查服务状态…</p>}
          {state === "unavailable" && <p role="alert">服务暂不可用</p>}
          {typeof state === "object" && (
            <section className="status-card" aria-label="平台状态">
              <p>服务运行正常</p>
              <p>SQLite 可用</p>
            </section>
          )}
        </div>
      </div>
      <div
        className="primary-panels"
        hidden={!visible("dashboard") && !settingsVisible}
      >
        <div hidden={!visible("dashboard")}>
          <DashboardPanel onOpenRun={(id) => void openDashboardRun(id)} />
        </div>
        <div className="primary-settings" hidden={!settingsVisible}>
          <SettingsPanel
            mode={diagnosisMode}
            provider={diagnosisProvider}
            model={diagnosisModel}
            apiKey={temporaryApiKey}
            message={connectionMessage}
            testing={testingConnection}
            backend={backendSettings}
            onModeChange={(mode, provider) => {
              clearAiSessionState();
              setDiagnosisMode(mode);
              if (provider) setDiagnosisProvider(provider);
            }}
            onModelChange={setDiagnosisModel}
            onApiKeyChange={setTemporaryApiKey}
            onTest={() => void checkAiConnection()}
            onLocalTest={() => void testLocalAiConnection()}
          />
        </div>
      </div>
      <div
        className="page-shell page-shell--compact"
        hidden={!visible("import")}
      >
        <ImportTaskPanel
          file={importFile}
          record={importRecord}
          name={importName}
          label={importLabel}
          permissionConfirmed={importPermissionConfirmed}
          busy={importBusy}
          message={importMessage}
          onFileChange={(file) => {
            setImportFile(file);
            setImportRecord(null);
            setImportMessage(null);
          }}
          onPermissionChange={setImportPermissionConfirmed}
          onNameChange={setImportName}
          onLabelChange={setImportLabel}
          onUpload={() => void uploadActualData()}
          onValidate={() => void validateActualData()}
          onConvert={() => void showConversionNotice()}
          onCreate={() => void addImportedTask()}
        />
      </div>
      <section
        hidden={!visible("new-task")}
        className="task-panel page-shell--compact"
        aria-labelledby="new-task-title"
      >
        <p className="eyebrow">新建任务</p>
        <h2 id="new-task-title">新建采集任务</h2>
        <p>
          先选择数据模式：快速和标准使用固定安全预设；只有自定义模式可以调整视频路数及详细参数。
        </p>
        <CollectionTaskForm
          disabled={tasks === null}
          saving={saving}
          onSubmit={submitTask}
        />
        {formError && <p role="alert">{formError}</p>}
      </section>
      <div className="saved-task-page" hidden={!visible("saved")}>
        <SavedTasksPanel
          taskDetails={tasks}
          executingTaskId={executingTaskId}
          tasks={savedTasks}
          error={savedTaskError}
          filters={savedTaskFilters}
          onFiltersChange={setSavedTaskFilters}
          onRefresh={(page, filters) => void refreshSavedTasks(page, filters)}
          onOpenRun={(id) => void openDashboardRun(id)}
          onExecute={(id) => void executeTask(id)}
          onArchive={(id) => void archiveSavedTask(id)}
          onDelete={(id) => void removeSavedTask(id)}
        />
      </div>
      {visible("run-detail") && runError && <p role="alert">{runError}</p>}
      {visible("run-detail") && selectedRun && (
        <RunDetail
          run={selectedRun}
          onCancel={() => void cancelSelectedRun()}
          onRerun={() => void rerunSelectedRun()}
          onReviewAlignment={(anchors) => void reviewSelectedAlignment(anchors)}
          diagnosisMode={diagnosisMode}
          diagnosisProvider={diagnosisProvider}
          diagnosisModel={diagnosisModel}
          temporaryApiKey={temporaryApiKey}
        />
      )}
    </main>
  );
}
