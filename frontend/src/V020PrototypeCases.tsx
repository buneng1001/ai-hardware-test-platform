import { useState } from "react";

import { Status, cases, type WorkspaceProps } from "./V020PrototypeShared";
import { V020AutomationCasesScreen } from "./V020AutomationCasesScreen";
import { V020SourceCasesScreen } from "./V020SourceCasesScreen";

type CasesSectionProps = Pick<
  WorkspaceProps,
  "projectWorkspace" | "caseView" | "setCaseView" | "setSection"
>;

export function CasesSection({
  projectWorkspace,
  caseView,
  setCaseView,
  setSection,
}: CasesSectionProps) {
  const automationCaseCount = cases.filter((item) => item.automation).length;
  const manualCaseCount = cases.length - automationCaseCount;
  const [focusedSourceCaseId, setFocusedSourceCaseId] = useState<number | null>(
    null,
  );
  const versionId = projectWorkspace.openedVersion?.id ?? null;

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
            onClick={() => {
              setCaseView(key);
              if (key === "source") setFocusedSourceCaseId(null);
            }}
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
          versionId={versionId}
          focusCaseId={focusedSourceCaseId}
          onOpenGroups={() => setSection("groups")}
          onOpenAutomation={() => setCaseView("automation")}
        />
      )}
      {caseView === "automation" && (
        <V020AutomationCasesScreen
          versionId={versionId}
          onOpenGroups={() => setSection("groups")}
          onOpenSource={(sourceTestCaseId) => {
            setFocusedSourceCaseId(sourceTestCaseId);
            setCaseView("source");
          }}
        />
      )}
    </section>
  );
}
