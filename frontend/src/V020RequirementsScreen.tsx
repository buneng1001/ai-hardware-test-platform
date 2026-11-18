import { useState } from "react";
import type { ProductVersion } from "./projectsApi";

import "./V020Requirements.css";

/** 需求材料入口仅提示开发中；版本级 AI 补充说明仍独立持久化。 */
export function V020RequirementsScreen({
  onOpenSource,
  version,
  onSaveAiContext,
}: {
  onOpenSource: () => void;
  version: ProductVersion | null;
  onSaveAiContext: (id: number, context: string) => Promise<ProductVersion>;
}) {
  const [placeholderNotice, setPlaceholderNotice] = useState("");
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
      setMessage(
        error instanceof Error
          ? `保存失败：${error.message}`
          : "保存失败，请重试。",
      );
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
            管理当前版本的需求材料操作；正式测试用例可在用例表中导入。
          </p>
        </div>

        <div className="prototype-actions">
          <button
            onClick={() => setPlaceholderNotice("该功能开发中")}
            type="button"
          >
            导入需求点
          </button>
          <button
            className="prototype-secondary"
            onClick={() => setPlaceholderNotice("该功能开发中")}
            type="button"
          >
            AI 分析
          </button>
          <button
            className="prototype-secondary"
            onClick={() => setPlaceholderNotice("该功能开发中")}
            type="button"
          >
            智能测试用例推荐
          </button>
          <button
            className="prototype-secondary"
            onClick={() => setPlaceholderNotice("该功能开发中")}
            type="button"
          >
            AI 风险分析与审核
          </button>
          <button
            className="prototype-secondary"
            onClick={onOpenSource}
            type="button"
          >
            导入用例
          </button>
        </div>

        {placeholderNotice && (
          <div className="prototype-actions">
            <span role="status">{placeholderNotice}</span>
            <button
              className="prototype-secondary"
              type="button"
              onClick={() => setPlaceholderNotice("")}
            >
              关闭提示
            </button>
          </div>
        )}
      </section>

      <section
        className="prototype-requirement-import"
        aria-label="本版本 AI 补充说明"
      >
        <div className="prototype-requirement-head">
          <h3>本版本 AI 补充说明</h3>
          <p className="prototype-muted">
            为当前产品版本补充希望 AI
            在后续测试工作中考虑的信息；与版本描述、需求文件互不影响。
          </p>
        </div>
        <label className="prototype-requirement-note">
          补充说明
          <textarea
            aria-label="本版本 AI 补充说明输入"
            value={note}
            disabled={!version || saving}
            onChange={(event) => {
              setNote(event.target.value);
              setMessage("");
            }}
            placeholder={
              version
                ? "可填写本版本的产品特性、测试要求、历史问题或其他补充信息"
                : "请先打开具体产品版本"
            }
            rows={5}
            aria-invalid={count > limit}
          />
        </label>
        <p className="prototype-muted" role="status">
          {count} / {limit} 字符
          {count > limit ? "，超过限制，无法保存" : dirty ? " · 尚未保存" : ""}
        </p>
        <div className="prototype-actions prototype-requirement-submit">
          <button
            className="prototype-primary"
            type="button"
            disabled={!version || !dirty || saving || count > limit}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <button
            className="prototype-secondary"
            type="button"
            disabled={!version || !dirty || saving}
            onClick={() => {
              setNote(saved);
              setMessage("");
            }}
          >
            撤销修改
          </button>
          {message && <span role="status">{message}</span>}
          {!version && (
            <span className="prototype-muted">请先进入一个产品版本。</span>
          )}
        </div>
      </section>
    </div>
  );
}
