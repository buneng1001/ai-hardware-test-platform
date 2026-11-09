/**
 * 执行器（Runner）的静态演示数据。
 * 这一版只做界面：执行器保存在本地存储，连接测试是模拟的，不会真的请求 CI。
 * 下一版接入后端后再替换这里。
 */
export type RunnerKind = "github" | "jenkins" | "local";

export type MockRunner = {
  id: string;
  kind: RunnerKind;
  name: string;
  /** GitHub: owner/repo@workflow；Jenkins: job 名；本地：项目路径。 */
  target: string;
  /** 连接测试是否通过。 */
  connected: boolean;
  lastMessage: string;
};

export const runnerKindLabels: Record<RunnerKind, string> = {
  github: "GitHub CI",
  jenkins: "Jenkins",
  local: "本地框架",
};

const STORAGE_KEY = "v020-mock-runners";
const GROUP_LINK_KEY = "v020-mock-group-runner";

export const defaultRunners: MockRunner[] = [
  {
    id: "runner-local-demo",
    kind: "local",
    name: "本地 pytest 框架",
    target: "D:/work/iris-autotest",
    connected: true,
    lastMessage: "路径存在，入口脚本可执行",
  },
  {
    id: "runner-jenkins-demo",
    kind: "jenkins",
    name: "Jenkins 回归流水线",
    target: "iris-regression",
    connected: false,
    lastMessage: "未连接：缺少访问令牌",
  },
];

export function readRunners(): MockRunner[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultRunners;
    const parsed = JSON.parse(raw) as MockRunner[];
    return Array.isArray(parsed) ? parsed : defaultRunners;
  } catch {
    return defaultRunners;
  }
}

export function saveRunners(runners: MockRunner[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runners));
  } catch {
    // 本地存储不可用时只影响演示数据的持久化。
  }
}

/** 模拟“测试连接”：只做基本格式检查，不发起真实网络请求。 */
export function simulateConnection(input: {
  kind: RunnerKind;
  target: string;
  token: string;
}): { ok: boolean; message: string } {
  const target = input.target.trim();
  if (!target) return { ok: false, message: "请先填写地址或路径" };
  if (input.kind === "github") {
    if (!/^[\w.-]+\/[\w.-]+/.test(target)) {
      return { ok: false, message: "GitHub 需要 owner/repo 格式" };
    }
    if (!input.token.trim()) return { ok: false, message: "缺少访问令牌" };
    return { ok: true, message: "已找到仓库与 workflow，令牌权限足够" };
  }
  if (input.kind === "jenkins") {
    if (!/^https?:\/\//.test(target)) {
      return { ok: false, message: "Jenkins 需要 http(s) 开头的地址" };
    }
    if (!input.token.trim()) return { ok: false, message: "缺少访问令牌" };
    return { ok: true, message: "已连接到 Jenkins，可读取任务列表" };
  }
  if (!/[\\/]/.test(target)) {
    return { ok: false, message: "本地模式需要填写项目目录的完整路径" };
  }
  return { ok: true, message: "目录存在，入口命令可用" };
}

export function readGroupRunnerLinks(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(GROUP_LINK_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function linkGroupRunner(groupId: number, runnerId: string) {
  const links = readGroupRunnerLinks();
  if (runnerId) links[String(groupId)] = runnerId;
  else delete links[String(groupId)];
  try {
    window.localStorage.setItem(GROUP_LINK_KEY, JSON.stringify(links));
  } catch {
    // 忽略存储失败。
  }
}
