import { Status, type WorkspaceProps } from "./V020PrototypeShared";
import { CasesSection } from "./V020PrototypeCases";
import { V020DataPackagesScreen } from "./V020DataPackagesScreen";
import { GroupSettingsSection } from "./V020PrototypeGroups";
import { PrototypeReportActions } from "./V020PrototypeReports";
import { V020VersionOverview } from "./V020VersionOverview";

export function WorkspaceContent(props: WorkspaceProps) {
  const {
    section,
    onRun,
    selectedGroup,
    setSelectedGroup,
    groups,
    onOpenManual,
  } = props;
  if (section === "overview")
    return <V020VersionOverview workspace={props.projectWorkspace} />;
  if (section === "cases") return <CasesSection {...props} />;
  if (section === "data")
    return <V020DataPackagesScreen onNavigate={props.onNavigate} />;
  if (section === "groups") return <GroupSettingsSection {...props} />;
  return (
    <>
      <div className="prototype-kicker">第 4 步 / 执行与汇总</div>
      <div className="prototype-group-selector">
        <label>
          当前测试组
          <select
            value={selectedGroup}
            onChange={(event) => setSelectedGroup(event.target.value)}
          >
            {Array.from(
              new Set([
                ...groups.map((group) => group.name),
                "EVT1 数据完整性专项",
              ]),
            ).map((groupName) => (
              <option key={groupName}>{groupName}</option>
            ))}
          </select>
        </label>
        <span className="prototype-muted">
          自动化结果、人工结果和最终报告均对应当前测试组
        </span>
      </div>
      <h2>自动化结果与最终报告</h2>
      <p className="prototype-muted">
        当前结果对应测试组“{selectedGroup}
        ”，人工结果可以反复修改并重新生成报告。
      </p>
      <div className="prototype-result-grid">
        <div className="prototype-result-card">
          <strong>自动化执行 #003</strong>
          <Status tone="good">已完成</Status>
          <p>执行时间：2026-09-15 10:32</p>
          <p>通过 8 · 失败 2 · 阻塞 1 · 未执行 1</p>
          <button className="prototype-secondary" onClick={onRun}>
            刷新最新结果
          </button>
        </div>
        <div className="prototype-result-card">
          <strong>人工测试记录</strong>
          <Status tone="warn">待补充</Status>
          <p>已录入 5 条，未执行 2 条</p>
          <button className="prototype-secondary" onClick={onOpenManual}>
            进入人工结果录入
          </button>
        </div>
      </div>
      <div className="prototype-report-preview">
        <div>
          <Status tone="warn">需关注</Status>
          <h3>{selectedGroup}：建议有条件进入下一阶段</h3>
          <p>
            当前报告来源：自动化执行 #003（2026-09-15 10:32）+ 人工记录 2 条。
          </p>
          <p>
            <strong>AI 回测建议：</strong>
            持续跟踪录制中断恢复、低电量采集与 IMU 时间戳漂移相关用例。
          </p>
        </div>
        <PrototypeReportActions selectedGroup={selectedGroup} />
      </div>
    </>
  );
}
