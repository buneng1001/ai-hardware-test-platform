import { useState } from "react";

import {
  Status,
  cases,
  dataPackages,
  sections,
  type CaseFilter,
  type CaseView,
  type DataFilter,
  type GroupView,
  type PrototypeProps,
  type ScreenKey,
  type SectionKey,
  type VariantProps,
} from "./V020PrototypeShared";
import { ManualResultsPage, WorkspaceContent } from "./V020PrototypeWorkspace";

function PrototypeHome({ onOpenProjects }: { onOpenProjects: () => void }) {
  return (
    <div className="prototype-home">
      <div className="prototype-home-copy">
        <div className="prototype-kicker">AI 辅助测试平台</div>
        <h1>
          <span>智能硬件</span>
          <span>自动化用例执行平台</span>
        </h1>
        <p>
          面向多传感器采集设备，从测试数据生成与校验，到自动化执行、人工结果汇总和测试报告分析。
        </p>
        <div className="prototype-home-capabilities">
          <span>数据驱动模拟</span>
          <span>自动化测试</span>
          <span>模块化报告</span>
          <span>AI 辅助分析</span>
        </div>
        <button className="prototype-primary" onClick={onOpenProjects}>
          开启平台
        </button>
      </div>
      <div className="prototype-ai-card">
        <div className="prototype-kicker">AI 配置</div>
        <h2>配置你的 AI 模型</h2>
        <p className="prototype-muted">
          AI
          用于自动化用例转换和最终报告分析。你也可以先不配置，之后在平台中补充。
        </p>
        <label>
          模型服务
          <select defaultValue="siliconflow">
            <option value="siliconflow">SiliconFlow</option>
            <option value="local">本地模型</option>
          </select>
        </label>
        <label>
          模型名称
          <input defaultValue="Qwen/Qwen2.5-72B-Instruct" />
        </label>
        <div className="prototype-actions">
          <button>测试 AI 连接</button>
          <button className="prototype-secondary" onClick={onOpenProjects}>
            暂不配置，进入平台
          </button>
        </div>
      </div>
    </div>
  );
}

function PrototypeProjects({
  onOpenWorkspace,
  onBack,
}: {
  onOpenWorkspace: () => void;
  onBack: () => void;
}) {
  return (
    <div className="prototype-projects">
      <div className="prototype-projects-head">
        <div>
          <div className="prototype-kicker">PROJECTS</div>
          <h1>项目列表</h1>
          <p className="prototype-muted">
            选择一个项目进入版本、趋势和测试工作区。
          </p>
        </div>
        <button className="prototype-secondary" onClick={onBack}>
          回到首页
        </button>
      </div>
      <div
        className="prototype-project-card"
        onClick={onOpenWorkspace}
        role="button"
        tabIndex={0}
      >
        <div>
          <Status tone="good">进行中</Status>
          <h2>IRIS 头环</h2>
          <p>多传感器采集设备 · 最近更新：今天</p>
        </div>
        <div>
          <strong>EVT1</strong>
          <span>3 份最终报告</span>
          <span>最近趋势：需补充验证</span>
        </div>
      </div>
      <button className="prototype-secondary">＋ 新建项目</button>
    </div>
  );
}

function VariantA({
  screen,
  setScreen,
  ...workspaceProps
}: VariantProps & {
  screen: ScreenKey;
  setScreen: (screen: ScreenKey) => void;
}) {
  if (screen === "home")
    return <PrototypeHome onOpenProjects={() => setScreen("projects")} />;
  if (screen === "projects")
    return (
      <PrototypeProjects
        onOpenWorkspace={() => setScreen("workspace")}
        onBack={() => setScreen("home")}
      />
    );
  if (screen === "manual")
    return (
      <div className="prototype-shell prototype-shell--sidebar">
        <aside>
          <div className="prototype-logo">IRIS TEST</div>
          <p className="prototype-sidebar-project">
            项目 / IRIS 头环
            <br />
            <small>产品版本 EVT1</small>
          </p>
          <div className="prototype-sidebar-navigation">
            {sections.map((item) => (
              <button
                className={
                  workspaceProps.section === item.key
                    ? "prototype-nav-active"
                    : ""
                }
                key={item.key}
                onClick={() => {
                  workspaceProps.setSection(item.key);
                  setScreen("workspace");
                }}
              >
                {item.label}
              </button>
            ))}
            <div className="prototype-sidebar-exit">
              <button
                className="prototype-back"
                onClick={() => setScreen("projects")}
              >
                切换项目
              </button>
              <button
                className="prototype-back"
                onClick={() => setScreen("home")}
              >
                返回首页
              </button>
            </div>
          </div>
        </aside>
        <main>
          <div className="prototype-topline">
            <span>v0.2.0 Web Demo</span>
            <Status tone="good">草稿自动保留在本次 Demo</Status>
          </div>
          <ManualResultsPage
            drafts={workspaceProps.manualDrafts}
            setDraft={workspaceProps.setManualDraft}
            onBack={() => setScreen("workspace")}
          />
        </main>
      </div>
    );
  return (
    <div className="prototype-shell prototype-shell--sidebar">
      <aside>
        <div className="prototype-logo">IRIS TEST</div>
        <p className="prototype-sidebar-project">
          项目 / IRIS 头环
          <br />
          <small>产品版本 EVT1</small>
        </p>
        <div className="prototype-sidebar-navigation">
          {sections.map((item) => (
            <button
              className={
                workspaceProps.section === item.key
                  ? "prototype-nav-active"
                  : ""
              }
              key={item.key}
              onClick={() => workspaceProps.setSection(item.key)}
            >
              {item.label}
            </button>
          ))}
          <div className="prototype-sidebar-exit">
            <button
              className="prototype-back"
              onClick={() => setScreen("projects")}
            >
              切换项目
            </button>
            <button
              className="prototype-back"
              onClick={() => setScreen("home")}
            >
              返回首页
            </button>
          </div>
        </div>
      </aside>
      <main>
        <div className="prototype-topline">
          <span>v0.2.0 Web Demo</span>
          <Status tone="good">本地假数据</Status>
        </div>
        <WorkspaceContent {...workspaceProps} />
      </main>
    </div>
  );
}

export function V020FrontendPrototype({ onNavigate }: PrototypeProps) {
  const [screen, setScreen] = useState<ScreenKey>("home");
  const [section, setSection] = useState<SectionKey>("overview");
  const [selected, setSelected] = useState<string[]>(["TC-REC-001"]);
  const [runCount, setRunCount] = useState(0);
  const [caseView, setCaseView] = useState<CaseView>("requirements");
  const [groupView, setGroupView] = useState<GroupView>("list");
  const [selectedGroup, setSelectedGroup] = useState("EVT1 基础录制回归");
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
    section,
    setSection,
    selected,
    onToggle: toggle,
    onSelectAll,
    onInvertSelection,
    onRun,
    onNavigate,
    caseView,
    setCaseView,
    groupView,
    setGroupView,
    selectedGroup,
    setSelectedGroup,
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
      <div className="prototype-banner">
        原型演示 · A 方案 · 仅本地假数据 · 不会写入后端{" "}
        {runCount > 0 && <span>· 已模拟执行 {runCount} 次</span>}
      </div>
      {view}
    </div>
  );
}
