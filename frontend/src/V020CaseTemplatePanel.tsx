import { useRef, useState } from "react";

/** 模板来源：平台默认模板，或用户自己上传的表头。 */
type TemplateSource = "default" | "uploaded";

/**
 * 冻结版“测试用例表”的模板区。
 * 提供默认模板与上传模板切换；可选择本地文件，解析尚未接入时不伪装为已上传。
 */
export function V020CaseTemplatePanel() {
  const [source, setSource] = useState<TemplateSource>("default");
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState("");

  return (
    <section className="prototype-case-template" aria-label="测试用例表模板">
      <div className="prototype-template-compact-row">
        <strong className="prototype-template-caption">用例模板：</strong>
        <div
          className="prototype-template-switch"
          role="group"
          aria-label="模板来源"
        >
          <button
            aria-pressed={source === "default"}
            className={
              source === "default" ? "is-selected" : "prototype-secondary"
            }
            onClick={() => setSource("default")}
            type="button"
          >
            默认模板
          </button>
          <button
            aria-pressed={source === "uploaded"}
            className={
              source === "uploaded" ? "is-selected" : "prototype-secondary"
            }
            onClick={() => setSource("uploaded")}
            type="button"
          >
            上传模板
          </button>
        </div>
        <span className="prototype-template-divider" aria-hidden="true" />
        <input
          ref={fileRef}
          aria-label="选择测试用例模板文件"
          className="prototype-file-input"
          accept=".csv,.xlsx,.xls"
          type="file"
          onChange={(event) => {
            setSelectedFile(event.target.files?.[0]?.name ?? "");
            event.target.value = "";
          }}
        />
        <button
          className="prototype-secondary prototype-template-choose-file"
          disabled={source === "default"}
          onClick={() => fileRef.current?.click()}
          type="button"
        >
          选择文件
        </button>
        <span className="prototype-template-feedback" aria-live="polite">
          {source === "default"
            ? "使用系统默认模板，无需上传"
            : selectedFile
              ? `已选择：${selectedFile}（解析暂未接入）`
              : "请选择 CSV / Excel 文件（解析暂未接入）"}
        </span>
      </div>
    </section>
  );
}
