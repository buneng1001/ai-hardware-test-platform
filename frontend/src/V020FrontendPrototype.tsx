import { useState } from "react";

import {
  cases,
  dataPackages,
  type CaseFilter,
  type CaseModuleFilter,
  type CaseView,
  type DataFilter,
  type GroupView,
  type PrototypeProps,
  type ScreenKey,
  type SectionKey,
  type VariantProps,
} from "./V020PrototypeShared";
import { PrototypeHome } from "./V020PrototypeEntryScreens";
import { ManualResultsPage } from "./V020PrototypeManualResults";
import { PrototypeWorkspaceShell } from "./V020PrototypeShell";
import { WorkspaceContent } from "./V020PrototypeWorkspace";
import { V020ProjectsScreen } from "./V020ProjectsScreen";
import { useV020ProjectWorkspace } from "./useV020ProjectWorkspace";

function VariantA({
  screen,
  setScreen,
  ...workspaceProps
}: VariantProps & {
  screen: ScreenKey;
  setScreen: (screen: ScreenKey) => void;
}) {
  const openProjects = () => {
    void workspaceProps.projectWorkspace.refreshProjects();
    setScreen("projects");
  };
  if (screen === "home") return <PrototypeHome onOpenProjects={openProjects} />;
  if (screen === "projects")
    return (
      <V020ProjectsScreen
        onBack={() => setScreen("home")}
        onOpen={(projectId) => {
          void workspaceProps.projectWorkspace
            .openProject(projectId)
            .then((opened) => {
              if (opened) setScreen("workspace");
            });
        }}
        workspace={workspaceProps.projectWorkspace}
      />
    );
  if (screen === "manual")
    return (
      <PrototypeWorkspaceShell
        section={workspaceProps.section}
        onSectionChange={(section) => {
          workspaceProps.setSection(section);
          setScreen("workspace");
        }}
        onOpenProjects={openProjects}
        onOpenHome={() => setScreen("home")}
      >
        <ManualResultsPage
          groupName={workspaceProps.selectedGroup}
          drafts={workspaceProps.manualDrafts}
          setDraft={workspaceProps.setManualDraft}
          onBack={() => setScreen("workspace")}
        />
      </PrototypeWorkspaceShell>
    );
  return (
    <PrototypeWorkspaceShell
      section={workspaceProps.section}
      onSectionChange={workspaceProps.setSection}
      onOpenProjects={openProjects}
      onOpenHome={() => setScreen("home")}
    >
      <WorkspaceContent {...workspaceProps} />
    </PrototypeWorkspaceShell>
  );
}

export function V020FrontendPrototype({ onNavigate }: PrototypeProps) {
  const projectWorkspace = useV020ProjectWorkspace();
  const [screen, setScreen] = useState<ScreenKey>("home");
  const [section, setSection] = useState<SectionKey>("overview");
  const [selected, setSelected] = useState<string[]>(["TC-REC-001"]);
  const [runCount, setRunCount] = useState(0);
  const [caseView, setCaseView] = useState<CaseView>("requirements");
  const [caseModuleFilter, setCaseModuleFilter] =
    useState<CaseModuleFilter>("all");
  const [groupView, setGroupView] = useState<GroupView>("list");
  const [selectedGroup, setSelectedGroup] = useState("EVT1 基础录制回归");
  const [groups, setGroups] = useState([
    {
      name: "EVT1 基础录制回归",
      status: "validated" as const,
      caseCount: 12,
      dataPackageCount: 2,
      recentRunCount: 3,
    },
    {
      name: "EVT1 断电故障验证",
      status: "not_run" as const,
      caseCount: 4,
      dataPackageCount: 1,
      recentRunCount: 0,
    },
  ]);
  const [newGroupName, setNewGroupName] = useState("");
  const [dataFilter, setDataFilter] = useState<DataFilter>("all");
  const [caseFilter, setCaseFilter] = useState<CaseFilter>("all");
  const [manualDrafts, setManualDrafts] = useState<
    Record<string, { result: string; note: string }>
  >({});
  const [dataAssignments, setDataAssignments] = useState<
    Record<string, string>
  >({
    "TC-REC-001": dataPackages[0],
    "TC-REC-002": dataPackages[1],
  });
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const onSelectAll = () => setSelected(cases.map((item) => item.id));
  const onInvertSelection = () =>
    setSelected((current) =>
      cases.map((item) => item.id).filter((id) => !current.includes(id)),
    );
  const onRun = () => setRunCount((count) => count + 1);
  const navigateSection = (nextSection: SectionKey) => {
    if (nextSection === "groups") setGroupView("list");
    setSection(nextSection);
  };
  const createGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setGroups((current) =>
      current.some((group) => group.name === name)
        ? current
        : [
            ...current,
            {
              name,
              status: "not_run",
              caseCount: selected.length,
              dataPackageCount: new Set(Object.values(dataAssignments)).size,
              recentRunCount: 0,
            },
          ],
    );
    setSelectedGroup(name);
    setNewGroupName("");
    setGroupView("detail");
  };
  const setDataAssignment = (caseId: string, dataId: string) =>
    setDataAssignments((current) => ({ ...current, [caseId]: dataId }));
  const setManualDraft = (
    caseId: string,
    field: "result" | "note",
    value: string,
  ) =>
    setManualDrafts((current) => ({
      ...current,
      [caseId]: {
        result: current[caseId]?.result ?? "",
        note: current[caseId]?.note ?? "",
        [field]: value,
      },
    }));
  const contentProps: VariantProps = {
    projectWorkspace,
    section,
    setSection: navigateSection,
    selected,
    onToggle: toggle,
    onSelectAll,
    onInvertSelection,
    onRun,
    onNavigate,
    caseView,
    setCaseView,
    caseModuleFilter,
    setCaseModuleFilter,
    groupView,
    setGroupView,
    selectedGroup,
    setSelectedGroup,
    groups,
    newGroupName,
    setNewGroupName,
    createGroup,
    dataAssignments,
    setDataAssignment,
    dataFilter,
    setDataFilter,
    caseFilter,
    setCaseFilter,
    manualDrafts,
    setManualDraft,
    onOpenManual: () => setScreen("manual"),
  };
  const view = (
    <VariantA {...contentProps} screen={screen} setScreen={setScreen} />
  );
  return (
    <div className="prototype-page">
      <div
        className={`prototype-banner${
          runCount === 0 ? " prototype-banner--placeholder" : ""
        }`}
        aria-hidden={runCount === 0}
      >
        {runCount > 0 ? `已模拟执行 ${runCount} 次` : "\u200b"}
      </div>
      <div
        className="prototype-screen-transition"
        data-testid="prototype-screen-transition"
        key={screen}
      >
        {view}
      </div>
    </div>
  );
}
