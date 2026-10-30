import { useEffect, useState } from "react";

import { Status } from "./V020PrototypeShared";
import {
  getManualTestResultPage,
  type ManualTestResultPage,
} from "./manualTestResultsApi";

/** 冻结版“执行与结果”人工记录卡片：显示最近批次数量并进入录入页。 */
export function V020ManualResultSummaryCard({
  groupId,
  groupName,
  onOpenManual,
}: {
  groupId: number;
  groupName: string;
  onOpenManual: (group: { id: number; name: string }) => void;
}) {
  const [page, setPage] = useState<ManualTestResultPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setPage(null);
    setError(null);
    void getManualTestResultPage(groupId)
      .then(setPage)
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "人工测试结果加载失败",
        ),
      );
  }, [groupId, reloadToken]);

  const latest = page?.batches[0];
  const savedCount = latest?.results.length ?? 0;
  const pendingCount = page
    ? page.cases.filter(
        (item) =>
          !latest?.results.some(
            (result) => result.source_test_case_id === item.id,
          ),
      ).length
    : 0;

  return (
    <div className="prototype-result-card">
      <strong>人工测试记录</strong>
      <Status tone={savedCount > 0 ? "good" : "warn"}>
        {savedCount > 0 ? "已保存" : "待补充"}
      </Status>
      {error ? (
        <div className="prototype-inline-note" role="alert">
          人工测试结果加载失败：{error}
          <button
            className="prototype-secondary"
            onClick={() => setReloadToken((current) => current + 1)}
            type="button"
          >
            重试
          </button>
        </div>
      ) : page === null ? (
        <p className="prototype-muted" role="status">
          正在加载人工测试记录…
        </p>
      ) : latest ? (
        <p>
          最近批次 #{latest.batch_number}：已保存 {savedCount} 条，未执行{" "}
          {pendingCount} 条。
        </p>
      ) : (
        <p>尚无人工记录；未填写项在报告中按未执行处理。</p>
      )}
      <button
        className="prototype-secondary"
        onClick={() => onOpenManual({ id: groupId, name: groupName })}
        type="button"
      >
        进入人工结果录入
      </button>
    </div>
  );
}
