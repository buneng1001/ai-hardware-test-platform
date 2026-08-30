import type {
  AiSettings,
  CollectionTask,
  DiagnosisMode,
  DiagnosisProvider,
  ImportRecord,
  SavedTaskPage,
} from "./collectionTasksApi";

export type PageKey =
  | "all"
  | "dashboard"
  | "new-task"
  | "import"
  | "saved"
  | "run-detail"
  | "settings";

export type SavedTaskFilters = {
  source?: "synthetic_generated" | "imported_actual_data";
  execution_status?: "never_executed" | "has_runs";
  archived?: boolean;
};

export type ImportPanelState = {
  file: File | null;
  record: ImportRecord | null;
  name: string;
  label: string;
  permissionConfirmed: boolean;
  busy: "upload" | "validate" | "convert" | "create" | null;
  message: string | null;
};

export type SettingsPanelState = {
  mode: DiagnosisMode;
  provider: DiagnosisProvider;
  model: string;
  apiKey: string;
  message: string | null;
  testing: boolean;
  backend: AiSettings | null;
};

export type SavedTasksPanelState = {
  tasks: SavedTaskPage | null;
  error: string | null;
  page: number;
  filters: SavedTaskFilters;
};

export type TaskListPanelProps = {
  tasks: CollectionTask[] | null;
  executingTaskId: number | null;
  onExecute: (taskId: number) => void;
};
