import { Status } from "./V020PrototypeShared";
import { PROTOTYPE_BRAND } from "./V020PrototypeBrand";
import { PrototypeBrandGlyph } from "./V020PrototypeBrandGlyph";
import { PrototypeAiConfiguration } from "./V020PrototypeAiConfiguration";

export function PrototypeHome({
  onOpenProjects,
}: {
  onOpenProjects: () => void;
}) {
  return (
    <div className="prototype-home">
      <PrototypeBrandGlyph
        className="prototype-home-brand-motion"
        testId="prototype-home-brand-motion"
      />
      <div className="prototype-home-copy">
        <div className="prototype-kicker">INTELLIGENT TEST WORKSPACE</div>
        <h1>
          {PROTOTYPE_BRAND.titleLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h1>
        <p>{PROTOTYPE_BRAND.subtitle}</p>
        <div className="prototype-home-capabilities">
          <span>数据驱动模拟</span>
          <span>自动化测试</span>
          <span>模块化报告</span>
          <span>AI 辅助分析</span>
        </div>
        <button className="prototype-primary" onClick={onOpenProjects}>
          开启平台 <span aria-hidden="true">→</span>
        </button>
      </div>
      <PrototypeAiConfiguration onSkip={onOpenProjects} />
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
