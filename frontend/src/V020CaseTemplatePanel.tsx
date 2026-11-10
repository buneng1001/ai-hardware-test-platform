import { useRef, useState } from "react";

import { DEFAULT_CASE_TEMPLATE_FIELDS, caseFieldLabel } from "./caseTemplate";

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
      <div className="prototype-case-template-head">
        <div>
          <h3>测试用例表模板</h3>
          <p className="prototype-muted">
            模板决定导入时识别哪些列。可以上传自己的表头，也可以直接用平台默认模板。
          </p>
        </div>
        <span className="prototype-template-badge">
          当前使用：{source === "default" ? "默认模板" : "上传模板"}
        </span>
      </div>

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

      {source === "default" ? (
        <div className="prototype-template-columns" aria-label="默认模板列">
          {DEFAULT_CASE_TEMPLATE_FIELDS.map((field, index) => (
            <span key={field}>
              <em>{index + 1}</em>
              {caseFieldLabel(field)}
            </span>
          ))}
        </div>
      ) : (
        <div className="prototype-template-upload">
          <p className="prototype-muted">
            {selectedFile ? `已选择：${selectedFile}` : "尚未选择文件。"}{" "}
            模板解析和保存暂未接入，选择文件不会自动上传。
          </p>
          <div className="prototype-actions">
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
              className="prototype-secondary"
              onClick={() => fileRef.current?.click()}
              type="button"
            >
              选择模板文件
            </button>
            <span className="prototype-muted">
              上传模板解析尚未接入，本轮只提供界面。
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
