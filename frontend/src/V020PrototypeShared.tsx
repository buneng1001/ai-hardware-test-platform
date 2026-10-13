export type PrototypeProps = { onNavigate: (page: "dashboard") => void };
export type SectionKey = "overview" | "cases" | "data" | "groups" | "results";
export type ScreenKey = "home" | "projects" | "workspace" | "manual";
export type CaseView = "requirements" | "source" | "automation";
export type GroupView = "list" | "create" | "detail";
export type DataFilter = "all" | "normal" | "fault" | "generated" | "imported";
export type CaseModuleFilter = "all" | "录制功能" | "电源管理";
export type CaseFilter =
  "all" | "录制功能" | "电源管理" | "automation" | "manual";
export type TestGroup = {
  name: string;
  status: "validated" | "not_run";
  caseCount: number;
  dataPackageCount: number;
  recentRunCount: number;
};
export type WorkspaceProps = {
  section: SectionKey;
  setSection: (section: SectionKey) => void;
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onInvertSelection: () => void;
  onRun: () => void;
  caseView: CaseView;
  setCaseView: (view: CaseView) => void;
  caseModuleFilter: CaseModuleFilter;
  setCaseModuleFilter: (filter: CaseModuleFilter) => void;
  groupView: GroupView;
  setGroupView: (view: GroupView) => void;
  selectedGroup: string;
  setSelectedGroup: (group: string) => void;
  groups: TestGroup[];
  newGroupName: string;
  setNewGroupName: (name: string) => void;
  createGroup: () => void;
  dataAssignments: Record<string, string>;
  setDataAssignment: (caseId: string, dataId: string) => void;
  dataFilter: DataFilter;
  setDataFilter: (filter: DataFilter) => void;
  caseFilter: CaseFilter;
  setCaseFilter: (filter: CaseFilter) => void;
  manualDrafts: Record<string, { result: string; note: string }>;
  setManualDraft: (
    caseId: string,
    field: "result" | "note",
    value: string,
  ) => void;
  onOpenManual: () => void;
};
export type VariantProps = WorkspaceProps & PrototypeProps;

export const sections: Array<{ key: SectionKey; label: string }> = [
  { key: "overview", label: "版本与趋势" },
  { key: "cases", label: "需求 / 测试用例" },
  { key: "data", label: "测试数据" },
  { key: "groups", label: "测试组设置" },
  { key: "results", label: "执行与结果" },
];

export const cases = [
  {
    id: "TC-REC-001",
    title: "短按录制键，确认开始录制",
    module: "录制功能",
    automation: true,
    steps: [
      "确认设备处于待机状态",
      "短按录制键并观察录制指示",
      "确认视频与 IMU 数据开始写入",
    ],
  },
  {
    id: "TC-REC-002",
    title: "录制中断后文件是否完整",
    module: "录制功能",
    automation: true,
    steps: [
      "启动视频与 IMU 录制",
      "模拟录制进程中断",
      "检查已生成文件是否完整且可读取",
    ],
  },
  {
    id: "TC-POWER-003",
    title: "设备断电后数据保存状态",
    module: "电源管理",
    automation: false,
    steps: [
      "在设备录制过程中断开电源",
      "恢复供电并重新启动设备",
      "检查断电前数据是否保存并可恢复",
    ],
  },
];
export const dataPackages = [
  "DP-REC-001 正常录制数据",
  "DP-FAULT-002 缺失 IMU 数据",
  "DP-FAULT-003 时间戳偏移",
];
export const dataAssets = [
  {
    id: "DP-REC-001",
    name: "正常录制数据",
    kind: "normal",
    source: "generated",
    detail: "视频 MP4 · IMU CSV · 128 MB",
  },
  {
    id: "DP-FAULT-002",
    name: "缺失 IMU 数据",
    kind: "fault",
    source: "generated",
    detail: "视频存在 · IMU 缺失 · 64 MB",
  },
  {
    id: "DP-FAULT-003",
    name: "时间戳偏移数据",
    kind: "fault",
    source: "imported",
    detail: "视频/IMU · 偏移 120 ms · 96 MB",
  },
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

export function CaseTable({
  selected,
  onToggle,
  showData = false,
  dataAssignments,
  onDataChange,
  automationView = false,
  caseFilter = "all",
}: {
  selected: string[];
  onToggle: (id: string) => void;
  showData?: boolean;
  dataAssignments?: Record<string, string>;
  onDataChange?: (caseId: string, dataId: string) => void;
  automationView?: boolean;
  caseFilter?: CaseFilter;
}) {
  const visibleCases = cases.filter(
    (item) =>
      caseFilter === "all" ||
      caseFilter === item.module ||
      (caseFilter === "automation" && item.automation) ||
      (caseFilter === "manual" && !item.automation),
  );
  return (
    <div className="prototype-table-wrap">
      <table className="prototype-table">
        <thead>
          <tr>
            <th>选择</th>
            <th>用例编号</th>
            <th>标题</th>
            <th>模块</th>
            <th>测试步骤</th>
            <th>自动化</th>
            {automationView && <th>AI 反馈</th>}
            {showData && <th>数据包</th>}
          </tr>
        </thead>
        <tbody>
          {visibleCases.map((item) => (
            <tr
              className={
                automationView && !item.automation
                  ? "prototype-row-warning"
                  : ""
              }
              key={item.id}
            >
              <td>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={() => onToggle(item.id)}
                />
              </td>
              <td>
                <a href="#source">{item.id}</a>
              </td>
              <td>{item.title}</td>
              <td>{item.module}</td>
              <td>
                <TestSteps steps={item.steps} />
              </td>
              <td>
                <Status tone={item.automation ? "good" : "warn"}>
                  {item.automation ? "可自动化" : "人工"}
                </Status>
              </td>
              {automationView && (
                <td>
                  <textarea
                    className="prototype-ai-feedback"
                    placeholder="给 AI 的修改意见（可选）"
                  />
                </td>
              )}
              {showData && (
                <td>
                  <input
                    aria-label={`数据包 ${item.id}`}
                    list={`prototype-data-packages-${item.id}`}
                    placeholder="输入或选择数据包编号"
                    value={dataAssignments?.[item.id] ?? dataPackages[0]}
                    onChange={(event) =>
                      onDataChange?.(item.id, event.target.value)
                    }
                  />
                  <datalist id={`prototype-data-packages-${item.id}`}>
                    <option value="不使用数据包" />
                    {dataPackages.map((dataPackage) => (
                      <option key={dataPackage} value={dataPackage} />
                    ))}
                  </datalist>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
