import { useRef, useState } from "react";

import "./V020Requirements.css";

/**
 * 冻结版“测试需求”子页：需求资料进入平台的入口。
 * 用户在这里导入需求点或现成用例，勾选“使用 AI 大模型解析上传文件”，
 * 再补一段说明，三者会一起提交给大模型分析。
 * 需求点解析尚未接入后端，本轮只提供界面，解析按钮保持禁用并写明原因。
 */
export function V020RequirementsScreen({
  onOpenSource,
}: {
  onOpenSource: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<string | null>(null);
  const [useAiParse, setUseAiParse] = useState(true);
  const [note, setNote] = useState("");

  return (
    <div className="prototype-requirements">
      <section className="prototype-requirement-import" aria-label="导入需求点">
        <div className="prototype-requirement-head">
          <div className="prototype-kicker">REQUIREMENT INTAKE</div>
          <h3>导入需求点</h3>
          <p className="prototype-muted">
            导入 Beta 产品的需求资料，或直接导入现成用例。勾选 AI 解析后，
            文件和下面的说明会一起发给大模型分析。
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

        <label className="prototype-requirement-note">
          对上传文件的说明（会随文件一起发给大模型）
          <textarea
            aria-label="对上传文件的说明"
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：这份文档是 Beta 版本录音模块的需求点，请按模块拆成可测试的需求点。"
            rows={4}
            value={note}
          />
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
            需求点解析尚未接入，本轮只提供界面；接入后这里会把文件和说明一起发给大模型。
          </span>
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
