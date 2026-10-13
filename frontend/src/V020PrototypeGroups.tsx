import {
  CaseTable,
  Status,
  type CaseFilter,
  type TestGroup,
  type WorkspaceProps,
} from "./V020PrototypeShared";

type GroupSettingsProps = Pick<
  WorkspaceProps,
  | "groupView"
  | "setGroupView"
  | "selectedGroup"
  | "setSelectedGroup"
  | "groups"
  | "newGroupName"
  | "setNewGroupName"
  | "createGroup"
  | "caseFilter"
  | "setCaseFilter"
  | "selected"
  | "onToggle"
  | "dataAssignments"
  | "setDataAssignment"
  | "onRun"
>;

function groupSummary(group: TestGroup) {
  const recentRuns = group.recentRunCount
    ? ` · 最近运行 ${group.recentRunCount} 次`
    : "";
  return `${group.caseCount} 条用例 · ${group.dataPackageCount} 个数据包${recentRuns}`;
}

export function GroupSettingsSection({
  groupView,
  setGroupView,
  selectedGroup,
  setSelectedGroup,
  groups,
  newGroupName,
  setNewGroupName,
  createGroup,
  caseFilter,
  setCaseFilter,
  selected,
  onToggle,
  dataAssignments,
  setDataAssignment,
  onRun,
}: GroupSettingsProps) {
  const currentGroup = groups.find((group) => group.name === selectedGroup);

  return (
    <>
      <div className="prototype-kicker">第 3 步 / 测试范围</div>
      <h2>测试组设置</h2>
      {groupView === "list" ? (
        <>
          <p className="prototype-muted">
            一个产品版本可以建立多个测试组，分别配置人工与自动化用例、测试范围和数据。
          </p>
          <div className="prototype-group-list">
            {groups.map((group) => (
              <div className="prototype-card" key={group.name}>
                <Status tone={group.status === "validated" ? "good" : "normal"}>
                  {group.status === "validated" ? "已校验" : "未运行"}
                </Status>
                <h3>{group.name}</h3>
                <p>{groupSummary(group)}</p>
                <button
                  className={
                    group.status === "validated" ? "" : "prototype-secondary"
                  }
                  onClick={() => {
                    setSelectedGroup(group.name);
                    setGroupView("detail");
                  }}
                >
                  编辑设置
                </button>
              </div>
            ))}
          </div>
          <button
            className="prototype-primary"
            onClick={() => setGroupView("create")}
          >
            ＋ 新建测试组
          </button>
        </>
      ) : groupView === "create" ? (
        <form
          className="prototype-card prototype-group-create"
          onSubmit={(event) => {
            event.preventDefault();
            createGroup();
          }}
        >
          <h3>创建测试组</h3>
          <label>
            测试组名称
            <input
              aria-label="测试组名称"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="例如：EVT1 录制与人工回归"
              maxLength={60}
              autoFocus
            />
          </label>
          <p className="prototype-inline-note">
            测试组名称仅可在创建时修改，创建后不支持修改。请确认名称准确后再创建。
          </p>
          <div className="prototype-actions">
            <button
              className="prototype-primary"
              disabled={!newGroupName.trim()}
            >
              创建测试组
            </button>
            <button
              className="prototype-secondary"
              type="button"
              onClick={() => setGroupView("list")}
            >
              取消
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="prototype-group-head">
            <div>
              <strong>{selectedGroup}</strong>
              {currentGroup && <p>{groupSummary(currentGroup)}</p>}
              <small className="prototype-muted">
                测试组名称创建后不可修改
              </small>
            </div>
            <Status
              tone={currentGroup?.status === "validated" ? "good" : "normal"}
            >
              {currentGroup?.status === "validated" ? "配置已校验" : "未运行"}
            </Status>
          </div>
          <div className="prototype-filter-row">
            <select
              value={caseFilter}
              onChange={(event) =>
                setCaseFilter(event.target.value as CaseFilter)
              }
            >
              <option value="all">全部用例</option>
              <option value="录制功能">录制功能</option>
              <option value="电源管理">电源管理</option>
              <option value="automation">只看自动化用例</option>
              <option value="manual">只看人工用例</option>
            </select>
            <button className="prototype-secondary">筛选</button>
          </div>
          <CaseTable
            selected={selected}
            onToggle={onToggle}
            showData
            dataAssignments={dataAssignments}
            onDataChange={setDataAssignment}
            caseFilter={caseFilter}
          />
          <div className="prototype-actions">
            <button>选择数据包</button>
            <button className="prototype-secondary">添加用例</button>
            <button className="prototype-primary" onClick={onRun}>
              执行自动化测试
            </button>
            <button
              className="prototype-secondary"
              onClick={() => setGroupView("list")}
            >
              返回设置列表
            </button>
          </div>
        </>
      )}
    </>
  );
}
