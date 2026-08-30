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
import { TaskListPanel } from "./TaskListPanel";
import type { PageKey, SavedTaskFilters } from "./appTypes";

type Health = { status: "ok"; database: "ok" };
type PageState = Health | "loading" | "unavailable";

export function useAppController() {
  const [state, setState] = useState<PageState>("loading");
  const [tasks, setTasks] = useState<CollectionTask[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [executingTaskId, setExecutingTaskId] = useState<number | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<PageKey>("all");
  const [diagnosisMode, setDiagnosisMode] = useState<DiagnosisMode>("mock");
  const [diagnosisProvider, setDiagnosisProvider] =
    useState<DiagnosisProvider>("siliconflow");
  const [diagnosisModel, setDiagnosisModel] = useState(
    "Qwen/Qwen2.5-72B-Instruct",
  );
  const [temporaryApiKey, setTemporaryApiKey] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [testingConnection, setTestingConnection] = useState(false);
  const [backendSettings, setBackendSettings] = useState<AiSettings | null>(
    null,
  );
  const [savedTasks, setSavedTasks] = useState<SavedTaskPage | null>(null);
  const [savedTaskError, setSavedTaskError] = useState<string | null>(null);
  const [savedTaskPage, setSavedTaskPage] = useState(1);
  const [savedTaskFilters, setSavedTaskFilters] = useState<SavedTaskFilters>(
    {},
  );
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importRecord, setImportRecord] = useState<ImportRecord | null>(null);
  const [importName, setImportName] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [importPermissionConfirmed, setImportPermissionConfirmed] =
    useState(false);
  const [importBusy, setImportBusy] = useState<
    "upload" | "validate" | "convert" | "create" | null
  >(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/health");
        setState(
          response.ok ? ((await response.json()) as Health) : "unavailable",
        );
      } catch {
        console.error("健康状态请求失败");
        setState("unavailable");
      }
      try {
        setTasks(await listCollectionTasks());
      } catch {
        console.error("采集任务列表加载失败");
        setTasks([]);
      }
    })();
  }, []);
  useEffect(() => {
    if (!selectedRun || isTerminalRun(selectedRun.status)) return;
    const timeout = window.setTimeout(async () => {
      try {
        setSelectedRun(await getRun(selectedRun.id));
      } catch {
        console.error("运行记录刷新失败");
        setRunError("运行状态刷新失败，请稍后重试");
      }
    }, 50);
    return () => window.clearTimeout(timeout);
  }, [selectedRun]);
  const submitTask = async (command: CollectionTaskCommand) => {
    setSaving(true);
    setFormError(null);
    try {
      const task = await createCollectionTask(command);
      setTasks((current) => [task, ...(current ?? [])]);
      return true;
    } catch {
      console.error("采集任务保存失败");
      setFormError("采集任务保存失败，请检查输入后重试");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const executeTask = async (taskId: number) => {
    setExecutingTaskId(taskId);
    setActivePage("run-detail");
    setRunError(null);
    try {
      setSelectedRun(await executeCollectionTask(taskId));
    } catch {
      console.error("采集任务执行失败");
      setRunError("采集任务执行失败，请稍后重试");
    } finally {
      setExecutingTaskId(null);
    }
  };
  const cancelSelectedRun = async () => {
    if (!selectedRun) return;
    try {
      setSelectedRun(await cancelRun(selectedRun.id));
    } catch {
      setRunError("取消运行失败，请刷新后重试");
    }
  };
  const rerunSelectedRun = async () => {
    if (!selectedRun) return;
    try {
      setSelectedRun(await rerun(selectedRun.id));
    } catch {
      setRunError("重新执行失败，请稍后重试");
    }
  };
  const reviewSelectedAlignment = async (
    anchors: Parameters<typeof reviewAlignment>[1],
  ) => {
    if (!selectedRun) return;
    try {
      setSelectedRun(await reviewAlignment(selectedRun.id, anchors));
    } catch (error) {
      const message = error instanceof Error ? error.message : "锚点复核失败";
      setRunError(`锚点复核失败：${message}`);
    }
  };
  const openDashboardRun = async (runId: number) => {
    setActivePage("run-detail");
    try {
      setSelectedRun(await getRun(runId));
    } catch {
      setRunError("运行详情加载失败，请稍后重试");
    }
  };
  const refreshSavedTasks = async (
    page = savedTaskPage,
    filters = savedTaskFilters,
  ) => {
    setSavedTaskError(null);
    try {
      setSavedTasks(await listSavedTasks(page, filters));
      setSavedTaskPage(page);
    } catch {
      console.error("已保存任务加载失败");
      setSavedTaskError("已保存任务加载失败，请稍后重试");
    }
  };
  const removeSavedTask = async (taskId: number) => {
    try {
      await deleteCollectionTask(taskId);
      await refreshSavedTasks();
    } catch (error) {
      const message = error instanceof Error ? error.message : "任务删除失败";
      setSavedTaskError(
        message.includes("只能归档") ? message : "任务删除失败，请刷新后重试",
      );
    }
  };
  const archiveSavedTask = async (taskId: number) => {
    try {
      await archiveCollectionTask(taskId);
      await refreshSavedTasks();
    } catch {
      setSavedTaskError("任务归档失败，请刷新后重试");
    }
  };
  const uploadActualData = async () => {
    if (!importFile) return;
    setImportBusy("upload");
    setImportMessage(null);
    try {
      setImportRecord(
        await uploadImport(importFile, importPermissionConfirmed),
      );
      setImportMessage("文件已上传，请点击“校验导入文件”继续");
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "实际测试文件上传失败",
      );
    } finally {
      setImportBusy(null);
    }
  };
  const validateActualData = async () => {
    if (!importRecord) return;
    setImportBusy("validate");
    setImportMessage(null);
    try {
      setImportRecord(await validateImport(importRecord.id));
      setImportMessage("导入校验通过，可以加入任务列表");
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "实际测试文件校验失败",
      );
    } finally {
      setImportBusy(null);
    }
  };
  const showConversionNotice = async () => {
    if (!importRecord) return;
    setImportBusy("convert");
    try {
      await convertImport(importRecord.id);
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "标准格式转换功能开发中",
      );
    } finally {
      setImportBusy(null);
    }
  };
  const addImportedTask = async () => {
    if (!importRecord || !importName.trim()) return;
    setImportBusy("create");
    setImportMessage(null);
    try {
      const task = await createImportedTask(
        importRecord.id,
        importName.trim(),
        importLabel.trim(),
      );
      setTasks((current) => [task, ...(current ?? [])]);
      setImportRecord((current) =>
        current
          ? { ...current, status: "imported", created_task_id: task.id }
          : current,
      );
      setImportMessage("导入型采集任务已加入列表，尚未执行");
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "导入任务创建失败",
      );
    } finally {
      setImportBusy(null);
    }
  };
  const checkAiConnection = async () => {
    setConnectionMessage(null);
    setTestingConnection(true);
    try {
      const result = await testAiConnection(
        diagnosisModel,
        temporaryApiKey,
        diagnosisProvider,
      );
      setConnectionMessage(
        result.ok
          ? result.provider === "siliconflow"
            ? result.message
            : `${result.provider}/${result.model}：${result.message}`
          : `连接失败：${result.message}`,
      );
    } catch {
      setConnectionMessage("连接测试请求失败，请检查后端状态");
    } finally {
      setTestingConnection(false);
    }
  };
  const loadBackendSettings = async () => {
    try {
      setBackendSettings(await getAiSettings());
    } catch {
      setConnectionMessage("后端设置状态读取失败，请检查服务状态");
    }
  };
  const visible = (page: PageKey) =>
    activePage === "all" || activePage === page;
  const navigate = (page: PageKey) => {
    setActivePage(page);
    if (page === "saved") void refreshSavedTasks();
  };

  return {
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
    loadBackendSettings,
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
  };
}
