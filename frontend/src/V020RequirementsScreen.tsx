import { useRef, useState } from "react";
import type { ProductVersion } from "./projectsApi";

import "./V020Requirements.css";

/** 版本级 AI 补充说明独立持久化；旧需求导入占位入口由 T12 单独处理。 */
export function V020RequirementsScreen({
  onOpenSource,
  version,
  onSaveAiContext,
}: {
  onOpenSource: () => void;
  version: ProductVersion | null;
  onSaveAiContext: (id: number, context: string) => Promise<ProductVersion>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<string | null>(null);
  const [useAiParse, setUseAiParse] = useState(true);
  const [note, setNote] = useState(version?.ai_context ?? "");
  const [saved, setSaved] = useState(version?.ai_context ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const limit = 3000;
  // Unicode 码点计数，与后端 Pydantic/Python len(str) 一致。
  const count = Array.from(note).length;
  const dirty = note !== saved;

  async function save() {
    if (!version || saving || count > limit) return;
    setSaving(true);
    setMessage("");
    try {
      await onSaveAiContext(version.id, note);
      setSaved(note);
      setMessage("已保存当前版本的 AI 补充说明。");
    } catch (error) {
      setMessage(error instanceof Error ? `保存失败：${error.message}` : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="prototype-requirements">
      <section className="prototype-requirement-import" aria-label="导入需求点">
        <div className="prototype-requirement-head">
          <div className="prototype-kicker">REQUIREMENT INTAKE</div>
          <h3>导入需求点</h3>
          <p className="prototype-muted">
            现成用例可直接进入测试用例表；需求材料入口由后续任务处理。
          </p>
        </div>

        <div className="prototype-actions">
          <button onClick={() => fileInputRef.current?.click()} type="button">
            导入需求点
          </button>
          <button
            className="prototype-secondary"
            onClick={onOpenSource}
            type="button"
          >
            导入用例
          </button>
          <input
            ref={fileInputRef}
            aria-label="选择需求资料文件"
            accept=".csv,.xlsx,.docx,.md,.txt"
            className="prototype-file-input"
            type="file"
            onChange={(event) => {
              setPickedFile(event.target.files?.[0]?.name ?? null);
              event.target.value = "";
            }}
          />
        </div>

        <p className="prototype-muted prototype-picked-file">
          {pickedFile ? `已选择文件：${pickedFile}` : "尚未选择文件。"}
        </p>

        <label className="prototype-checkbox">
          <input
            checked={useAiParse}
            onChange={(event) => setUseAiParse(event.target.checked)}
            type="checkbox"
          />
          使用 AI 大模型解析上传文件
        </label>

        <div className="prototype-actions prototype-requirement-submit">
          <button
            className="prototype-primary"
            disabled
            title="需求点解析尚未接入"
            type="button"
          >
            开始解析
          </button>
          <span className="prototype-muted">
            下方版本级 AI 补充说明独立于本区，不随需求文件提交。
          </span>
        </div>
      </section>

      <section className="prototype-requirement-import" aria-label="本版本 AI 补充说明">
        <div className="prototype-requirement-head">
          <h3>本版本 AI 补充说明</h3>
          <p className="prototype-muted">为当前产品版本补充希望 AI 在后续测试工作中考虑的信息；与版本描述、需求文件互不影响。</p>
        </div>
        <label className="prototype-requirement-note">
          补充说明
          <textarea
            aria-label="本版本 AI 补充说明输入"
            value={note}
            disabled={!version || saving}
            onChange={(event) => { setNote(event.target.value); setMessage(""); }}
            placeholder={version ? "可填写本版本的产品特性、测试要求、历史问题或其他补充信息" : "请先打开具体产品版本"}
            rows={5}
            aria-invalid={count > limit}
          />
        </label>
        <p className="prototype-muted" role="status">{count} / {limit} 字符{count > limit ? "，超过限制，无法保存" : dirty ? " · 尚未保存" : ""}</p>
        <div className="prototype-actions prototype-requirement-submit">
          <button className="prototype-primary" type="button" disabled={!version || !dirty || saving || count > limit} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
          <button className="prototype-secondary" type="button" disabled={!version || !dirty || saving} onClick={() => { setNote(saved); setMessage(""); }}>撤销修改</button>
          {message && <span role="status">{message}</span>}
          {!version && <span className="prototype-muted">请先进入一个产品版本。</span>}
        </div>
      </section>

      <section className="prototype-requirement-list" aria-label="需求点列表">
        <h3>需求点列表</h3>
        <p className="prototype-muted">
          暂无需求点。导入并解析后，需求点会按模块出现在这里，并可以勾选生成测试用例。
        </p>
      </section>
    </div>
  );
}
