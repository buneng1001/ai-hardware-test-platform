import { useState } from "react";

import type { WorkspaceProps } from "./V020PrototypeShared";
import { V020AutomationCasesScreen } from "./V020AutomationCasesScreen";
import { V020RequirementsScreen } from "./V020RequirementsScreen";
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
        <V020RequirementsScreen onOpenSource={() => setCaseView("source")} />
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
