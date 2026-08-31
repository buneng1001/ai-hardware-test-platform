import type { ImportRecord } from "./collectionTasksApi";
import { downloadManifestTemplate } from "./manifestTemplate";

type ImportTaskPanelProps = {
  file: File | null;
  record: ImportRecord | null;
  name: string;
  label: string;
  permissionConfirmed: boolean;
  busy: "upload" | "validate" | "convert" | "create" | null;
  message: string | null;
  onFileChange: (file: File | null) => void;
  onPermissionChange: (confirmed: boolean) => void;
  onNameChange: (name: string) => void;
  onLabelChange: (label: string) => void;
  onUpload: () => void;
  onValidate: () => void;
  onConvert: () => void;
  onCreate: () => void;
};

export function ImportTaskPanel(props: ImportTaskPanelProps) {
  const validation = props.record?.validation;
  const warnings = validation?.warnings ?? [];
  const errors = validation?.errors ?? [];

  return (
    <section className="task-panel" aria-labelledby="import-task-title">
      <p className="eyebrow">根据导入生成</p>
      <h2 id="import-task-title">根据导入生成</h2>
      <p>只接受一个 ZIP；平台会在隔离区完成安全、结构和兼容性校验。</p>
      <button
        type="button"
        className="secondary-button"
        onClick={downloadManifestTemplate}
      >
        下载 manifest.json 模板
      </button>
      <label>
        实际测试 ZIP
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(event) =>
            props.onFileChange(event.target.files?.[0] ?? null)
          }
        />
      </label>
      <label className="permission-confirmation">
        <input
          id="import-permission-confirmation"
          type="checkbox"
          checked={props.permissionConfirmed}
          aria-label="确认具有处理和展示权限"
          onChange={(event) => props.onPermissionChange(event.target.checked)}
        />
        我确认具有处理和展示这些数据的权限
      </label>
      <div className="button-row">
        <button
          type="button"
          disabled={
            !props.file || !props.permissionConfirmed || props.busy !== null
          }
          onClick={props.onUpload}
        >
          {props.busy === "upload" ? "上传中…" : "导入实际测试文件"}
        </button>
        <button
          type="button"
          disabled={!props.record || props.busy !== null}
          onClick={props.onValidate}
        >
          {props.busy === "validate" ? "校验中…" : "校验导入文件"}
        </button>
        <button
          type="button"
          disabled={
            props.record?.status !== "nonstandard_convertible" ||
            props.busy !== null
          }
          onClick={props.onConvert}
        >
          转为标准格式
        </button>
      </div>
      {props.record && (
        <section aria-label="导入状态与校验结果">
          {props.record.status === "uploaded" ? (
            <p>文件已上传，尚未校验</p>
          ) : (
            <p>
              校验状态：
              {props.record.status === "passed"
                ? "通过"
                : props.record.status === "failed"
                  ? "不通过"
                  : props.record.status}
            </p>
          )}
          {warnings.map((warning) => (
            <p key={warning}>警告：{warning}</p>
          ))}
          {errors.map((error) => (
            <p key={error}>错误：{error}</p>
          ))}
        </section>
      )}
      <label>
        导入任务名称
        <input
          aria-label="导入任务名称"
          value={props.name}
          onChange={(event) => props.onNameChange(event.target.value)}
        />
      </label>
      <label htmlFor="import-test-label">
        测试标签
        <span className="field-help">
          用于标记这批实际数据的来源或用途，例如“版本 1.2
          回归测试”。填写后便于在任务列表中筛选和识别。
        </span>
        <input
          id="import-test-label"
          value={props.label}
          onChange={(event) => props.onLabelChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={
          props.record?.status !== "passed" ||
          !props.name.trim() ||
          props.busy !== null
        }
        onClick={props.onCreate}
      >
        {props.busy === "create" ? "加入中…" : "加入任务列表"}
      </button>
      {props.message && <p role="status">{props.message}</p>}
    </section>
  );
}
