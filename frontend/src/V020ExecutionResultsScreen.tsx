import { useEffect, useState } from "react";

import { Status } from "./V020PrototypeShared";
import { V020ExecutionResultCard } from "./V020ExecutionResultCard";
import { PrototypeReportActions } from "./V020PrototypeReports";
import { listTestGroups, type TestGroupSummary } from "./testGroupsApi";
import "./V020AutomationExecutions.css";

/**
 * 冻结版“执行与结果”页：真实测试组选择和自动化执行记录；
 * 人工结果与最终报告仍保持后续 issue 的样例入口。
 */
export function V020ExecutionResultsScreen({
  versionId,
  onOpenManual,
}: {
  versionId: number | null;
  onOpenManual: () => void;
}) {
  const [groups, setGroups] = useState<TestGroupSummary[] | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (versionId === null) {
      setGroups([]);
      return;
    }
    setGroups(null);
    setError(null);
    void listTestGroups(versionId, { hidden: false })
      .then((result) => {
        setGroups(result.items);
        setGroupId((current) =>
          current !== null && result.items.some((item) => item.id === current)
            ? current
            : (result.items[0]?.id ?? null),
        );
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "测试组加载失败"),
      );
  }, [versionId, reloadToken]);

  const groupName =
    groups?.find((item) => item.id === groupId)?.name ?? "未选择测试组";

  return (
    <>
      <div className="prototype-kicker">第 4 步 / 执行与汇总</div>
      <div className="prototype-group-selector">
        <label>
          当前测试组
          <select
            aria-label="当前测试组"
            disabled={groups === null || groups.length === 0}
            onChange={(event) => setGroupId(Number(event.target.value))}
            value={groupId ?? ""}
          >
            {(groups ?? []).map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <span className="prototype-muted">
          自动化结果、人工结果和最终报告均对应当前测试组
        </span>
      </div>
      <h2>自动化结果与最终报告</h2>
      <p className="prototype-muted">
        当前结果对应测试组“{groupName}”，人工结果可以反复修改并重新生成报告。
      </p>
      {error && (
        <div className="prototype-inline-note" role="alert">
          测试组加载失败：{error}
          <button
            className="prototype-secondary"
            onClick={() => setReloadToken((current) => current + 1)}
            type="button"
          >
            重试
          </button>
        </div>
      )}
      {!error && groups === null && (
        <p className="prototype-muted" role="status">
          正在加载测试组…
        </p>
      )}
      {groups !== null && groups.length === 0 && (
        <div className="prototype-card">
          <h3>还没有测试组</h3>
          <p className="prototype-muted">
            请先在“测试组设置”中创建测试组、加入用例并关联数据包，再执行自动化测试。
          </p>
        </div>
      )}
      {groupId !== null && (
        <div className="prototype-result-grid">
          <V020ExecutionResultCard groupId={groupId} />
          <div className="prototype-result-card">
            <strong>人工测试记录</strong>
            <Status tone="warn">待补充</Status>
            <p>已录入 5 条，未执行 2 条</p>
            <button
              className="prototype-secondary"
              onClick={onOpenManual}
              type="button"
            >
              进入人工结果录入
            </button>
          </div>
        </div>
      )}
      <div className="prototype-report-preview">
        <div>
          <Status tone="warn">需关注</Status>
          <h3>{groupName}：建议有条件进入下一阶段</h3>
          <p>当前报告来源：自动化执行结果 + 人工记录。</p>
          <p>
            <strong>AI 回测建议：</strong>
            持续跟踪录制中断恢复、低电量采集与 IMU 时间戳漂移相关用例。
          </p>
        </div>
        <PrototypeReportActions selectedGroup={groupName} />
      </div>
    </>
  );
}
