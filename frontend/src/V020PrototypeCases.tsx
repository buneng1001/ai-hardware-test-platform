import {
  CaseTable,
  Status,
  cases,
  type WorkspaceProps,
} from "./V020PrototypeShared";
import { PrototypeModuleFilter } from "./V020PrototypeModuleFilter";
import { V020SourceCasesScreen } from "./V020SourceCasesScreen";

type CasesSectionProps = Pick<
  WorkspaceProps,
  | "projectWorkspace"
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
  projectWorkspace,
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
  const automationCaseCount = cases.filter((item) => item.automation).length;
  const manualCaseCount = cases.length - automationCaseCount;

  return (
    <section className="prototype-cases-section">
      <header className="prototype-section-heading">
        <div>
          <div className="prototype-kicker">TEST CASE MANAGEMENT</div>
          <h2>需求 / 测试用例</h2>
          <p className="prototype-muted">
            管理当前版本的需求资料、原始测试用例与自动化转换结果。
          </p>
        </div>
        <div className="prototype-case-summary" aria-label="用例概况">
          <span>
            <strong>{cases.length}</strong> 全部用例
          </span>
          <span>
            <strong>{automationCaseCount}</strong> 可自动化
          </span>
          <span>
            <strong>{manualCaseCount}</strong> 人工验证
          </span>
        </div>
      </header>
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
          <Status tone="warn">未启用</Status>
          <p className="prototype-muted">
            需求点拆解与需求到用例生成在 v0.2.0
            未启用，平台不会伪造需求点或测试用例。
          </p>
          <p className="prototype-muted">
            需要导入 Beta
            产品需求或测试用例资料时，请进入“测试用例表”核对字段映射后导入；资料导入不依赖上述能力。
          </p>
          <div className="prototype-actions">
            <button onClick={() => setCaseView("source")} type="button">
              前往导入测试用例资料
            </button>
          </div>
        </div>
      )}
      {caseView === "source" && (
        <V020SourceCasesScreen
          versionId={projectWorkspace.openedVersion?.id ?? null}
          onOpenGroups={() => setSection("groups")}
        />
      )}
      {caseView === "automation" && (
        <>
          <div className="prototype-case-toolbar">
            <p className="prototype-muted">
              先核对导入字段，再生成自动化用例。当前勾选 {selected.length} 条。
            </p>
            <div className="prototype-filter-row">
              <PrototypeModuleFilter
                value={caseModuleFilter}
                onChange={setCaseModuleFilter}
              />
            </div>
            <div className="prototype-actions">
              <button>导入用例表</button>
              <button className="prototype-secondary">
                提交修改并重新生成
              </button>
              <button className="prototype-secondary">校验自动化用例</button>
              <button
                className="prototype-secondary"
                onClick={() => setSection("groups")}
              >
                加入测试组
              </button>
              <button className="prototype-secondary" onClick={onSelectAll}>
                全选
              </button>
              <button
                className="prototype-secondary"
                onClick={onInvertSelection}
              >
                反选
              </button>
            </div>
          </div>
          <CaseTable
            selected={selected}
            onToggle={onToggle}
            automationView
            caseFilter={caseModuleFilter}
          />
          <div className="prototype-inline-note">
            原始用例和自动化用例分开保存；自动化表的每行可填写给 AI
            的修改意见，提交后再点击校验。
          </div>
        </>
      )}
    </section>
  );
}
