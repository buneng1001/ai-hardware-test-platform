import {
  CaseTable,
  type CaseModuleFilter,
  type WorkspaceProps,
} from "./V020PrototypeShared";

type CasesSectionProps = Pick<
  WorkspaceProps,
  | "caseView"
  | "setCaseView"
  | "caseModuleFilter"
  | "setCaseModuleFilter"
  | "selected"
  | "onToggle"
  | "onSelectAll"
  | "onInvertSelection"
  | "setSection"
>;

export function CasesSection({
  caseView,
  setCaseView,
  caseModuleFilter,
  setCaseModuleFilter,
  selected,
  onToggle,
  onSelectAll,
  onInvertSelection,
  setSection,
}: CasesSectionProps) {
  return (
    <>
      <div className="prototype-kicker">第 1 步 / 用例资产</div>
      <h2>需求 / 测试用例</h2>
      <div className="prototype-subtabs">
        {(
          [
            ["requirements", "测试需求"],
            ["source", "测试用例表"],
            ["automation", "自动化用例表"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={
              caseView === key ? "prototype-nav-active" : "prototype-secondary"
            }
            onClick={() => setCaseView(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {caseView === "requirements" && (
        <div className="prototype-card prototype-requirements">
          <p className="prototype-muted">
            导入 Beta 产品需求资料，AI 可根据需求辅助整理测试用例。
          </p>
          <label>
            需求资料
            <textarea defaultValue="本版本重点验证录制、数据完整性和断电恢复。" />
          </label>
          <div className="prototype-actions">
            <button>导入需求文件</button>
            <button className="prototype-secondary">保存需求</button>
          </div>
        </div>
      )}
      {caseView !== "requirements" && (
        <>
          <p className="prototype-muted">
            先核对导入字段，再生成自动化用例。当前勾选 {selected.length} 条。
          </p>
          <div className="prototype-filter-row">
            <label>
              用例模块
              <select
                aria-label="用例模块"
                value={caseModuleFilter}
                onChange={(event) =>
                  setCaseModuleFilter(event.target.value as CaseModuleFilter)
                }
              >
                <option value="all">全部模块</option>
                <option value="录制功能">录制功能</option>
                <option value="电源管理">电源管理</option>
              </select>
            </label>
          </div>
          <div className="prototype-actions">
            <button>导入 Beta 用例表</button>
            {caseView === "source" && (
              <button className="prototype-secondary">生成自动化用例</button>
            )}
            {caseView === "automation" && (
              <>
                <button className="prototype-secondary">
                  提交修改并重新生成
                </button>
                <button className="prototype-secondary">校验自动化用例</button>
              </>
            )}
            <button
              className="prototype-secondary"
              onClick={() => setSection("groups")}
            >
              加入测试组
            </button>
            <button className="prototype-secondary" onClick={onSelectAll}>
              全选
            </button>
            <button className="prototype-secondary" onClick={onInvertSelection}>
              反选
            </button>
          </div>
          <CaseTable
            selected={selected}
            onToggle={onToggle}
            automationView={caseView === "automation"}
            caseFilter={caseModuleFilter}
          />
          <div className="prototype-inline-note">
            原始用例和自动化用例分开保存；自动化表的每行可填写给 AI
            的修改意见，提交后再点击校验。
          </div>
        </>
      )}
    </>
  );
}
