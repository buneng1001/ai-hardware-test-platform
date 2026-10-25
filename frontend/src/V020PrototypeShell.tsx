import { useState, type ReactNode } from "react";

import { PROTOTYPE_BRAND } from "./V020PrototypeBrand";
import { sections, type SectionKey } from "./V020PrototypeShared";

const SIDEBAR_STORAGE_KEY = "iris-test-sidebar-collapsed";

function readStoredSidebarState() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSidebarState(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    return true;
  } catch {
    return false;
  }
}

function initialSidebarState() {
  const saved = readStoredSidebarState();
  if (saved !== null) return saved === "true";
  return window.matchMedia?.("(max-width: 1180px)").matches ?? false;
}

function NavigationIcon({ section }: { section: SectionKey }) {
  const paths: Record<SectionKey, ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    cases: (
      <>
        <path d="M7 5h14M7 12h14M7 19h14" />
        <path d="M3 5h.01M3 12h.01M3 19h.01" />
      </>
    ),
    data: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
        <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
      </>
    ),
    groups: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2" />
        <path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6M15 15c3 0 5 1.7 6 5" />
      </>
    ),
    results: (
      <>
        <path d="m5 3 14 9-14 9Z" />
        <path d="M9 9v6l5-3Z" />
      </>
    ),
  };

  return (
    <svg className="prototype-nav-icon" aria-hidden="true" viewBox="0 0 24 24">
      {paths[section]}
    </svg>
  );
}

export function PrototypeWorkspaceShell({
  section,
  onSectionChange,
  onOpenProjects,
  onOpenHome,
  children,
}: {
  section: SectionKey;
  onSectionChange: (section: SectionKey) => void;
  onOpenProjects: () => void;
  onOpenHome: () => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialSidebarState);
  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;
      storeSidebarState(next);
      return next;
    });
  };

  return (
    <div
      className={`prototype-shell prototype-shell--sidebar${
        collapsed ? " prototype-shell--collapsed" : ""
      }`}
      data-testid="prototype-workspace-shell"
    >
      <aside aria-label="项目导航">
        <div
          className="prototype-sidebar-brand"
          aria-label={PROTOTYPE_BRAND.name}
        >
          <span className="prototype-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="prototype-sidebar-brand-copy">
            <strong>{PROTOTYPE_BRAND.shortName}</strong>
            <small>AUTOMATION TEST PLATFORM</small>
          </span>
        </div>
        <button
          className="prototype-sidebar-toggle"
          type="button"
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          onClick={toggleSidebar}
        >
          <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
        </button>
        <div className="prototype-sidebar-project">
          <span className="prototype-project-avatar">IR</span>
          <span className="prototype-sidebar-project-copy">
            <strong>IRIS 头环</strong>
            <small>EVT1 · 开发验证阶段</small>
          </span>
        </div>
        <nav className="prototype-sidebar-navigation" aria-label="工作区导航">
          <span className="prototype-sidebar-label">项目导航</span>
          {sections.map((item) => (
            <button
              aria-label={item.label}
              className={section === item.key ? "prototype-nav-active" : ""}
              key={item.key}
              title={collapsed ? item.label : undefined}
              onClick={() => onSectionChange(item.key)}
            >
              <NavigationIcon section={item.key} />
              <span className="prototype-nav-text">{item.label}</span>
            </button>
          ))}
          <div className="prototype-sidebar-exit">
            <button
              aria-label="切换项目"
              className="prototype-back"
              title={collapsed ? "切换项目" : undefined}
              onClick={onOpenProjects}
            >
              <span className="prototype-nav-symbol" aria-hidden="true">
                ↔
              </span>
              <span className="prototype-nav-text">切换项目</span>
            </button>
            <button
              aria-label="返回首页"
              className="prototype-back"
              title={collapsed ? "返回首页" : undefined}
              onClick={onOpenHome}
            >
              <span className="prototype-nav-symbol" aria-hidden="true">
                ⌂
              </span>
              <span className="prototype-nav-text">返回首页</span>
            </button>
          </div>
        </nav>
      </aside>
      <main>
        <div className="prototype-topline">
          <span>
            工作空间&nbsp;&nbsp;/&nbsp;&nbsp;IRIS
            头环&nbsp;&nbsp;/&nbsp;&nbsp;EVT1
          </span>
          <span className="prototype-workspace-status">本地工作区</span>
        </div>
        {children}
      </main>
    </div>
  );
}
