import { Status } from "./V020PrototypeShared";

export function PrototypeHome({
  onOpenProjects,
}: {
  onOpenProjects: () => void;
}) {
  return (
    <div className="prototype-home">
      <div className="prototype-home-copy">
        <div className="prototype-kicker">AI 辅助测试平台</div>
        <h1>
          <span>智能硬件</span>
          <span>自动化用例执行平台</span>
        </h1>
        <p>
          面向多传感器采集设备，从测试数据生成与校验，到自动化执行、人工结果汇总和测试报告分析。
        </p>
        <div className="prototype-home-capabilities">
          <span>数据驱动模拟</span>
          <span>自动化测试</span>
          <span>模块化报告</span>
          <span>AI 辅助分析</span>
        </div>
        <button className="prototype-primary" onClick={onOpenProjects}>
          开启平台
        </button>
      </div>
      <div className="prototype-ai-card">
        <div className="prototype-kicker">AI 配置</div>
        <h2>配置你的 AI 模型</h2>
        <p className="prototype-muted">
          AI
          用于自动化用例转换和最终报告分析。你也可以先不配置，之后在平台中补充。
        </p>
        <label>
          模型服务
          <select defaultValue="siliconflow">
            <option value="siliconflow">SiliconFlow</option>
            <option value="local">本地模型</option>
          </select>
        </label>
        <label>
          模型名称
          <input defaultValue="Qwen/Qwen2.5-72B-Instruct" />
        </label>
        <div className="prototype-actions">
          <button>测试 AI 连接</button>
          <button className="prototype-secondary" onClick={onOpenProjects}>
            暂不配置，进入平台
          </button>
        </div>
      </div>
    </div>
  );
}

export function PrototypeProjects({
  onOpenWorkspace,
  onBack,
}: {
  onOpenWorkspace: () => void;
  onBack: () => void;
}) {
  return (
    <div className="prototype-projects">
      <div className="prototype-projects-head">
        <div>
          <div className="prototype-kicker">PROJECTS</div>
          <h1>项目列表</h1>
          <p className="prototype-muted">
            选择一个项目进入版本、趋势和测试工作区。
          </p>
        </div>
        <button className="prototype-secondary" onClick={onBack}>
          回到首页
        </button>
      </div>
      <div
        className="prototype-project-card"
        onClick={onOpenWorkspace}
        role="button"
        tabIndex={0}
      >
        <div>
          <Status tone="good">进行中</Status>
          <h2>IRIS 头环</h2>
          <p>多传感器采集设备 · 最近更新：今天</p>
        </div>
        <div>
          <strong>EVT1</strong>
          <span>3 份最终报告</span>
          <span>最近趋势：需补充验证</span>
        </div>
      </div>
      <button className="prototype-secondary">＋ 新建项目</button>
    </div>
  );
}
