import { useEffect, useRef, useState } from "react";

import {
  type CaseView,
  type PrototypeProps,
  type ScreenKey,
  type SectionKey,
} from "./V020PrototypeShared";
import { PrototypeHome } from "./V020PrototypeEntryScreens";
import { ManualResultsPage } from "./V020PrototypeManualResults";
import { PrototypeWorkspaceShell } from "./V020PrototypeShell";
import { WorkspaceContent } from "./V020PrototypeWorkspace";
import { V020ProjectsScreen } from "./V020ProjectsScreen";
import { useV020ProjectWorkspace } from "./useV020ProjectWorkspace";

const NAV_STORAGE_KEY = "iris-test-v020-navigation";
const SECTION_KEYS: SectionKey[] = [
  "overview",
  "cases",
  "data",
  "groups",
  "results",
];

type StoredNavigation = {
  screen: ScreenKey;
  section: SectionKey;
  projectId: number | null;
};

const FALLBACK_NAVIGATION: StoredNavigation = {
  screen: "home",
  section: "overview",
  projectId: null,
};

/** 读取上次停留的位置；内容失效时回到首页，避免刷新后落在空白页。 */
function readStoredNavigation(): StoredNavigation {
  try {
    const raw = window.sessionStorage.getItem(NAV_STORAGE_KEY);
    if (!raw) return FALLBACK_NAVIGATION;
    const parsed = JSON.parse(raw) as Partial<StoredNavigation>;
    const projectId =
      typeof parsed.projectId === "number" ? parsed.projectId : null;
    const screen: ScreenKey =
      parsed.screen === "projects" || parsed.screen === "workspace"
        ? parsed.screen
        : "home";
    // 没有项目上下文就不能停在需要项目的工作区。
    if (screen === "workspace" && projectId === null) {
      return FALLBACK_NAVIGATION;
    }
    const section = SECTION_KEYS.includes(parsed.section as SectionKey)
      ? (parsed.section as SectionKey)
      : "overview";
    return { screen, section, projectId };
  } catch {
    return FALLBACK_NAVIGATION;
  }
}

function storeNavigation(state: StoredNavigation) {
  try {
    window.sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时只影响刷新恢复，不影响当前会话。
  }
}

export function V020FrontendPrototype({ onNavigate }: PrototypeProps) {
  const restored = useRef(readStoredNavigation());
  const projectWorkspace = useV020ProjectWorkspace();
  const [screen, setScreen] = useState<ScreenKey>(restored.current.screen);
  const [section, setSection] = useState<SectionKey>(restored.current.section);
  const [caseView, setCaseView] = useState<CaseView>("requirements");
  const [manualGroup, setManualGroup] = useState<{
    id: number;
    name: string;
  } | null>(null);

  /** 刷新页面后重新打开上次的项目；项目已不存在时退回项目列表。 */
  useEffect(() => {
    const projectId = restored.current.projectId;
    if (projectId === null) return;
    void projectWorkspace.openProject(projectId).then((opened) => {
      if (!opened) setScreen("projects");
    });
    // 只在挂载时恢复一次，后续导航由用户操作驱动。
  }, []);

  /** 记录当前位置，刷新后可以回到同一页。 */
  useEffect(() => {
    storeNavigation({
      screen,
      section,
      projectId: projectWorkspace.detail?.id ?? null,
    });
  }, [screen, section, projectWorkspace.detail]);

  const openProjects = () => {
    // 进入项目列表时清空上一次的搜索条件，避免筛选状态跨页面残留。
    projectWorkspace.clearSearch();
    setScreen("projects");
  };

  /** 侧边栏切页：如果在“逐条录入人工测试”等子页面，要回到工作区。 */
  const navigateSection = (next: SectionKey) => {
    setSection(next);
    setScreen("workspace");
  };

  const shellProps = {
    section,
    onSectionChange: navigateSection,
    onOpenProjects: openProjects,
    onOpenHome: () => setScreen("home"),
    projectName: projectWorkspace.detail?.name,
    versionLabel: projectWorkspace.openedVersion?.version,
  };

  const renderScreen = () => {
    if (screen === "home")
      return <PrototypeHome onOpenProjects={openProjects} />;
    if (screen === "projects")
      return (
        <V020ProjectsScreen
          onBack={() => setScreen("home")}
          onOpen={(projectId) => {
            void projectWorkspace.openProject(projectId).then((opened) => {
              if (!opened) return;
              // 每次从列表打开项目都从“版本与趋势”开始，避免停留在上次的页签。
              setSection("overview");
              setScreen("workspace");
            });
          }}
          workspace={projectWorkspace}
        />
      );
    if (screen === "manual")
      return (
        <PrototypeWorkspaceShell {...shellProps}>
          <ManualResultsPage
            groupId={manualGroup?.id ?? null}
            groupName={manualGroup?.name ?? "未选择测试组"}
            onBack={() => setScreen("workspace")}
          />
        </PrototypeWorkspaceShell>
      );
    return (
      <PrototypeWorkspaceShell {...shellProps}>
        <WorkspaceContent
          projectWorkspace={projectWorkspace}
          section={section}
          setSection={setSection}
          caseView={caseView}
          setCaseView={setCaseView}
          onNavigate={onNavigate}
          onOpenManual={(group) => {
            setManualGroup(group);
            setScreen("manual");
          }}
        />
      </PrototypeWorkspaceShell>
    );
  };

  return (
    <div className="prototype-page">
      <div
        className="prototype-screen-transition"
        data-testid="prototype-screen-transition"
        key={screen}
      >
        {renderScreen()}
      </div>
    </div>
  );
}
