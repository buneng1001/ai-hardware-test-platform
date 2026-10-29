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
