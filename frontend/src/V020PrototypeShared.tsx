export type PrototypeProps = { onNavigate: (page: "dashboard") => void };
export type SectionKey = "overview" | "cases" | "data" | "groups" | "results";
export type ScreenKey = "home" | "projects" | "workspace" | "manual";
export type CaseView = "requirements" | "source" | "automation";
export type GroupView = "list" | "detail";
export type DataFilter = "all" | "normal" | "fault" | "generated" | "imported";
export type CaseFilter =
  "all" | "录制功能" | "电源管理" | "automation" | "manual";
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
  groupView: GroupView;
  setGroupView: (view: GroupView) => void;
  selectedGroup: string;
  setSelectedGroup: (group: string) => void;
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
  { key: "groups", label: "自动化测试设置" },
  { key: "results", label: "执行与结果" },
];

export const cases = [
  {
    id: "TC-REC-001",
    title: "短按录制键，确认开始录制",
    module: "录制功能",
    automation: true,
  },
  {
    id: "TC-REC-002",
    title: "录制中断后文件是否完整",
    module: "录制功能",
    automation: true,
  },
  {
    id: "TC-POWER-003",
    title: "设备断电后数据保存状态",
    module: "电源管理",
    automation: false,
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
                  <select
                    value={dataAssignments?.[item.id] ?? dataPackages[0]}
                    onChange={(event) =>
                      onDataChange?.(item.id, event.target.value)
                    }
                  >
                    <option value="">不使用数据包</option>
                    {dataPackages.map((dataPackage) => (
                      <option key={dataPackage} value={dataPackage}>
                        {dataPackage}
                      </option>
                    ))}
                  </select>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
