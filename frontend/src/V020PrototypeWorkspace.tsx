import {
  CaseTable,
  Status,
  cases,
  dataAssets,
  dataPackages,
  type CaseFilter,
  type DataFilter,
  type WorkspaceProps,
} from "./V020PrototypeShared";

export function ManualResultsPage({
  drafts,
  setDraft,
  onBack,
}: {
  drafts: Record<string, { result: string; note: string }>;
  setDraft: (caseId: string, field: "result" | "note", value: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="prototype-manual-content">
      <div className="prototype-kicker">人工测试结果</div>
      <h1>逐条录入人工测试</h1>
      <p className="prototype-muted">
        测试组：EVT1
        基础录制回归。可以先录入几条，保存后离开；下次进入仍能继续填写。
      </p>
      <div className="prototype-manual-list">
        {cases
          .filter((item) => !item.automation || item.id === "TC-REC-001")
          .map((item) => (
            <div className="prototype-manual-row" key={item.id}>
              <div>
                <a href="#source">{item.id}</a>
                <h3>{item.title}</h3>
              </div>
              <label>
                测试结果
                <select
                  value={drafts[item.id]?.result ?? ""}
                  onChange={(event) =>
                    setDraft(item.id, "result", event.target.value)
                  }
                >
                  <option value="">未填写</option>
                  <option value="passed">通过</option>
                  <option value="failed">失败</option>
                  <option value="blocked">阻塞</option>
                </select>
              </label>
              <label>
                测试记录
                <textarea
                  value={drafts[item.id]?.note ?? ""}
                  onChange={(event) =>
                    setDraft(item.id, "note", event.target.value)
                  }
                  placeholder="输入本条人工测试记录"
                />
              </label>
            </div>
          ))}
      </div>
      <div className="prototype-actions">
        <button>保存当前修改</button>
        <button className="prototype-secondary" onClick={onBack}>
          返回执行与结果
        </button>
      </div>
    </div>
  );
}

export function WorkspaceContent({
  section,
  selected,
  onToggle,
  onSelectAll,
  onInvertSelection,
  onRun,
  caseView,
  setCaseView,
  groupView,
  setGroupView,
  selectedGroup,
  setSelectedGroup,
  dataAssignments,
  setDataAssignment,
  setSection,
  dataFilter,
  setDataFilter,
  caseFilter,
  setCaseFilter,
  onOpenManual,
}: WorkspaceProps) {
  const selectedCount = selected.length;
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
  if (section === "cases")
    return (
      <>
        <div className="prototype-kicker">第 1 步 / 用例资产</div>
        <h2>需求 / 测试用例</h2>
        <div className="prototype-subtabs">
          {(
            [
              ["requirements", "测试需求"],
              ["source", "测试用例表"],
              ["automation", "自动化用例表"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={
                caseView === key
                  ? "prototype-nav-active"
                  : "prototype-secondary"
              }
              onClick={() => setCaseView(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {caseView === "requirements" && (
          <div className="prototype-card prototype-requirements">
            <p className="prototype-muted">
              导入 Beta 产品需求资料，AI 可根据需求辅助整理测试用例。
            </p>
            <label>
              需求资料
              <textarea defaultValue="本版本重点验证录制、数据完整性和断电恢复。" />
            </label>
            <div className="prototype-actions">
              <button>导入需求文件</button>
              <button className="prototype-secondary">保存需求</button>
            </div>
          </div>
        )}
        {caseView !== "requirements" && (
          <>
            <p className="prototype-muted">
              先核对导入字段，再生成自动化用例。当前勾选 {selectedCount} 条。
            </p>
            <div className="prototype-actions">
              <button>导入 Beta 用例表</button>
              {caseView === "source" && (
                <button className="prototype-secondary">生成自动化用例</button>
              )}
              {caseView === "automation" && (
                <>
                  <button className="prototype-secondary">
                    提交修改并重新生成
                  </button>
                  <button className="prototype-secondary">
                    校验自动化用例
                  </button>
                </>
              )}
              <button
                className="prototype-secondary"
                onClick={() => setSection("groups")}
              >
                加入自动化测试设置
              </button>
              <button className="prototype-secondary" onClick={onSelectAll}>
                全选
              </button>
              <button
                className="prototype-secondary"
                onClick={onInvertSelection}
              >
                反选
              </button>
            </div>
            <CaseTable
              selected={selected}
              onToggle={onToggle}
              automationView={caseView === "automation"}
            />
            <div className="prototype-inline-note">
              原始用例和自动化用例分开保存；自动化表的每行可填写给 AI
              的修改意见，提交后再点击校验。
            </div>
          </>
        )}
      </>
    );
  if (section === "data")
    return (
      <>
        <div className="prototype-kicker">第 2 步 / 数据任务</div>
        <h2>生成或导入测试数据</h2>
        <div className="prototype-filter-row">
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
                <h3>
                  {asset.id} · {asset.name}
                </h3>
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
  if (section === "groups")
    return (
      <>
        <div className="prototype-kicker">第 3 步 / 测试范围</div>
        <h2>自动化测试设置</h2>
        {groupView === "list" ? (
          <>
            <p className="prototype-muted">
              一个产品版本可以建立多个自动化测试组，分别配置不同的测试范围和数据。
            </p>
            <div className="prototype-group-list">
              <div className="prototype-card">
                <Status tone="good">已校验</Status>
                <h3>EVT1 基础录制回归</h3>
                <p>12 条用例 · 2 个数据包 · 最近运行 3 次</p>
                <button onClick={() => setGroupView("detail")}>编辑设置</button>
              </div>
              <div className="prototype-card">
                <Status tone="normal">未运行</Status>
                <h3>EVT1 断电故障验证</h3>
                <p>4 条用例 · 1 个故障数据包</p>
                <button
                  className="prototype-secondary"
                  onClick={() => setGroupView("detail")}
                >
                  编辑设置
                </button>
              </div>
            </div>
            <button
              className="prototype-primary"
              onClick={() => setGroupView("detail")}
            >
              ＋ 新建自动化测试组
            </button>
          </>
        ) : (
          <>
            <div className="prototype-group-head">
              <div>
                <strong>EVT1 基础录制回归</strong>
                <p>12 条用例 · 2 个数据包 · 最近运行 3 次</p>
              </div>
              <Status tone="good">配置已校验</Status>
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
            <option>EVT1 基础录制回归</option>
            <option>EVT1 断电故障验证</option>
            <option>EVT1 数据完整性专项</option>
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
        </div>
        <div className="prototype-actions">
          <button className="prototype-primary">生成最终报告</button>
          <button className="prototype-secondary">查看报告列表</button>
          <button className="prototype-secondary">下载 HTML</button>
          <button className="prototype-secondary">下载纯文字</button>
        </div>
      </div>
    </>
  );
}
