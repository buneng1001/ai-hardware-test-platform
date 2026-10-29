/** 冻结版创建测试组表单：只填基本信息，可带入当前待加入清单。 */
export function V020TestGroupCreateForm({
  busy,
  name,
  description,
  includeSelected,
  onNameChange,
  onDescriptionChange,
  onIncludeSelectedChange,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  name: string;
  description: string;
  includeSelected: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onIncludeSelectedChange: (value: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="prototype-card prototype-group-create"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h3>创建测试组</h3>
      <label>
        测试组名称
        <input
          aria-label="测试组名称"
          autoFocus
          disabled={busy}
          maxLength={120}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="例如：EVT1 录制与人工回归"
          value={name}
        />
      </label>
      <label>
        测试组说明
        <textarea
          aria-label="测试组说明"
          disabled={busy}
          maxLength={1000}
          onChange={(event) => onDescriptionChange(event.target.value)}
          rows={2}
          value={description}
        />
      </label>
      <label>
        <input
          aria-label="带入当前待加入的原始用例"
          checked={includeSelected}
          onChange={(event) => onIncludeSelectedChange(event.target.checked)}
          type="checkbox"
        />
        带入当前待加入的原始用例
      </label>
      <p className="prototype-inline-note">
        测试组名称仅可在创建时修改，创建后不支持修改。请确认名称准确后再创建。
      </p>
      <div className="prototype-actions">
        <button className="prototype-primary" disabled={busy || !name.trim()}>
          创建测试组
        </button>
        <button
          className="prototype-secondary"
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
  );
}
