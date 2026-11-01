/**
 * 暂存“待加入测试组”的勾选。
 * 原始用例表和自动化用例表的“加入测试组”会把当前勾选写在这里，
 * 测试组页读取后一次性加入，避免用户重新一个个勾。
 */
export type PendingGroupCases = {
  source: number[];
  automation: number[];
};

const STORAGE_KEY = "v020-pending-group-cases";

export function readPendingGroupCases(): PendingGroupCases {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { source: [], automation: [] };
    const parsed = JSON.parse(raw) as Partial<PendingGroupCases>;
    return {
      source: Array.isArray(parsed.source) ? parsed.source : [],
      automation: Array.isArray(parsed.automation) ? parsed.automation : [],
    };
  } catch {
    return { source: [], automation: [] };
  }
}

export function mergePendingGroupCases(next: Partial<PendingGroupCases>) {
  const current = readPendingGroupCases();
  const merged: PendingGroupCases = {
    source: [...new Set([...current.source, ...(next.source ?? [])])],
    automation: [
      ...new Set([...current.automation, ...(next.automation ?? [])]),
    ],
  };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // 存储不可用时只影响跨页面携带，不影响当前页面操作。
  }
  return merged;
}

export function clearPendingGroupCases() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略存储不可用的情况。
  }
}
