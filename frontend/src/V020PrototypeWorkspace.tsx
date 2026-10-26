import {
  Status,
  dataAssets,
  type DataFilter,
  type WorkspaceProps,
} from "./V020PrototypeShared";
import { CasesSection } from "./V020PrototypeCases";
import { GroupSettingsSection } from "./V020PrototypeGroups";
import { PrototypeReportActions } from "./V020PrototypeReports";

export function WorkspaceContent(props: WorkspaceProps) {
  const {
    section,
    onRun,
    selectedGroup,
    setSelectedGroup,
    groups,
    setSection,
    dataFilter,
    setDataFilter,
    onOpenManual,
  } = props;
  const copyDataId = (dataId: string) => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(dataId).catch(() => undefined);
  };
  if (section === "overview")
    return (
      <>
        <div className="prototype-kicker">项目 / IRIS 头环</div>
        <h2>EVT1 测试工作区</h2>
        <div className="prototype-conclusion">
          当前结论：最近一轮录制模块需要补充验证
        </div>
        <div className="prototype-metric-row">
          <button
            className="prototype-metric-button"
            onClick={() => setSection("results")}
          >
            <strong>3</strong>
            <span>最终报告</span>
            <small>查看报告列表</small>
          </button>
          <div>
            <strong>82%</strong>
            <span>自动化通过率</span>
            <small>共 12 条自动化用例</small>
          </div>
          <div>
            <strong>2</strong>
            <span>待回归项</span>
          </div>
        </div>
        <div className="prototype-chart">
          <span style={{ height: "42%" }} />
          <span style={{ height: "65%" }} />
          <span style={{ height: "52%" }} />
          <span style={{ height: "78%" }} />
          <span style={{ height: "70%" }} />
        </div>
        <p className="prototype-muted">
          趋势图只统计最终报告，可按版本、模块、测试组和用例筛选。
        </p>
      </>
    );
  if (section === "cases") return <CasesSection {...props} />;
  if (section === "data")
    return (
      <>
        <div className="prototype-kicker">第 2 步 / 数据任务</div>
        <h2>生成或导入测试数据</h2>
        <div className="prototype-filter-row prototype-data-toolbar">
          <input placeholder="搜索数据编号或名称" />
          <select
            value={dataFilter}
            onChange={(event) =>
              setDataFilter(event.target.value as DataFilter)
            }
          >
            <option value="all">全部数据</option>
            <option value="normal">正常数据</option>
            <option value="fault">故障数据</option>
            <option value="generated">平台生成</option>
            <option value="imported">用户导入</option>
          </select>
          <button className="prototype-secondary">筛选</button>
        </div>
        <div className="prototype-data-grid">
          {dataAssets
            .filter(
              (asset) =>
                dataFilter === "all" ||
                dataFilter === asset.kind ||
                dataFilter === asset.source,
            )
            .map((asset) => (
              <div className="prototype-card" key={asset.id}>
                <Status tone={asset.kind === "fault" ? "warn" : "good"}>
                  {asset.kind === "fault" ? "故障数据" : "已校验"}
                </Status>
                <div className="prototype-data-title">
                  <h3>
                    {asset.id} · {asset.name}
                  </h3>
                  <button
                    className="prototype-copy-button"
                    type="button"
                    title="复制编号"
                    aria-label={`复制数据编号 ${asset.id}`}
                    onClick={() => copyDataId(asset.id)}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                    >
                      <path d="M8 8h11v11H8z" />
                      <path d="M5 16H3V3h13v2" />
                    </svg>
                  </button>
                </div>
                <p>
                  {asset.detail} ·{" "}
                  {asset.source === "generated" ? "平台生成" : "用户导入"}
                </p>
                <button className="prototype-secondary">查看数据详情</button>
              </div>
            ))}
        </div>
        <div className="prototype-actions">
          <button>生成新的数据包</button>
          <button className="prototype-secondary">导入数据并校验</button>
          <button className="prototype-secondary">执行/刷新数据任务</button>
        </div>
        <div className="prototype-legacy-tools">
          <strong>v0.1.0 数据能力</strong>
          <span>
            新建任务、根据导入生成、已保存任务和运行详情继续作为本模块内部能力接入。
          </span>
        </div>
        <div className="prototype-inline-note">
          测试组只能选择这里已经校验过的数据包。
        </div>
      </>
    );
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
