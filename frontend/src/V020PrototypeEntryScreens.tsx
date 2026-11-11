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
      <header className="prototype-home-topbar">
        <div className="prototype-home-top-brand">
          <PrototypeBrandGlyph className="prototype-home-header-mark" />
          <span>{PROTOTYPE_BRAND.name}</span>
        </div>
      </header>
      <div className="prototype-home-copy">
        <h1>
          {PROTOTYPE_BRAND.titleLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h1>
        <div className="prototype-kicker">
          INTELLIGENT HARDWARE TEST WORKSPACE
        </div>
        <p>{PROTOTYPE_BRAND.subtitle}</p>
        <div className="prototype-home-logo-stage">
          <img
            className="prototype-home-brand-motion prototype-te-book-logo-preview"
            data-testid="prototype-home-brand-motion"
            src="/branding/te-book-logo-preview.png"
            alt="TE 字母与翻开的精装书组成的 Logo 预览"
          />
        </div>
        <div className="prototype-home-capabilities">
          <span>项目管理</span>
          <span>自动化测试</span>
          <span>测试数据</span>
          <span>报告分析</span>
        </div>
        <button className="prototype-primary" onClick={onOpenProjects}>
          开启平台 <span aria-hidden="true">→</span>
        </button>
      </div>
      <PrototypeAiConfiguration onSkip={onOpenProjects} />
    </div>
  );
}
