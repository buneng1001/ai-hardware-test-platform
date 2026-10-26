export type PrototypeReport = {
  id: string;
  createdAt: string;
  source: string;
  conclusion: string;
  verdict: string;
  latest: boolean;
  stats: readonly [number, number, number, number];
  summary: string;
  advice: string;
};

export const prototypeReportHistory: readonly PrototypeReport[] = [
  {
    id: "003",
    createdAt: "2026-09-15 11:08",
    source: "自动化执行 #003 + 人工记录 2 条",
    conclusion: "建议有条件进入下一阶段",
    verdict: "有条件通过",
    latest: true,
    stats: [12, 8, 2, 1],
    summary:
      "核心录制链路已达到 EVT1 验证目标；断电恢复与低电量采集仍需完成回归，建议关闭高优先级问题后进入下一阶段。",
    advice:
      "下一轮优先建立“断电恢复 × 低电量 × 长时采集”的组合回归组；连续三轮稳定通过后，再将相关用例从持续跟踪清单移出。",
  },
  {
    id: "002",
    createdAt: "2026-09-08 18:20",
    source: "自动化执行 #002 + 人工记录 4 条",
    conclusion: "补充断电恢复验证后复测",
    verdict: "待回归",
    latest: false,
    stats: [12, 7, 3, 1],
    summary:
      "录制主流程已恢复稳定，但异常断电后仍有一条文件索引未正确重建，本轮暂不建议关闭问题。",
    advice:
      "补充 20 次随机断电恢复测试，并把文件索引重建时长和可读性作为连续观测指标。",
  },
  {
    id: "001",
    createdAt: "2026-09-01 16:42",
    source: "自动化执行 #001 + 人工记录 3 条",
    conclusion: "录制链路存在阻塞项",
    verdict: "未通过",
    latest: false,
    stats: [10, 5, 3, 2],
    summary:
      "首次 EVT1 回归发现录制中断后无法继续写入，阻塞后续数据完整性验证，需要修复后重新执行。",
    advice:
      "先修复录制状态机的中断恢复，再分别执行正常录制、主动停止和异常断电三组最小回归。",
  },
];
