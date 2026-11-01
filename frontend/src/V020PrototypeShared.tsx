import type { V020ProjectWorkspace } from "./useV020ProjectWorkspace";

export type PrototypeProps = {
  onNavigate: (page: "dashboard" | "new-task" | "import" | "saved") => void;
};
export type SectionKey = "overview" | "cases" | "data" | "groups" | "results";
export type ScreenKey = "home" | "projects" | "workspace" | "manual";
export type CaseView = "requirements" | "source" | "automation";
export type CaseModuleFilter = "all" | "录制功能" | "电源管理";

/**
 * 冻结版工作区实际需要的上下文。
 * 早期原型曾在这里挂大量本地样例状态，现已由真实接口页面取代，只保留当前用到的部分。
 */
export type WorkspaceProps = {
  projectWorkspace: V020ProjectWorkspace;
  section: SectionKey;
  setSection: (section: SectionKey) => void;
  caseView: CaseView;
  setCaseView: (view: CaseView) => void;
  onNavigate: PrototypeProps["onNavigate"];
  onOpenManual: (group: { id: number; name: string }) => void;
};

export const sections: Array<{ key: SectionKey; label: string }> = [
  { key: "overview", label: "版本与趋势" },
  { key: "cases", label: "需求 / 测试用例" },
  { key: "data", label: "测试数据" },
  { key: "groups", label: "测试组设置" },
  { key: "results", label: "执行与结果" },
];

export function Status({
  children,
  tone = "normal",
}: {
  children: string;
  tone?: "normal" | "warn" | "good";
}) {
  return (
    <span className={`prototype-status prototype-status--${tone}`}>
      {children}
    </span>
  );
}

export function TestSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="prototype-test-steps">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}
