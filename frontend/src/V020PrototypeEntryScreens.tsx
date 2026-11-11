import { PROTOTYPE_BRAND } from "./V020PrototypeBrand";
import { PrototypeBrandGlyph } from "./V020PrototypeBrandGlyph";
import { PrototypeAiConfiguration } from "./V020PrototypeAiConfiguration";
import { PrototypeTeBookMotion } from "./V020TeBookMotion";

export function PrototypeHome({
  onOpenProjects,
}: {
  onOpenProjects: () => void;
}) {
  return (
    <div className="prototype-home">
      <div className="prototype-home-ribbon" aria-hidden="true">
        <svg
          viewBox="0 0 1600 900"
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <linearGradient
              id="prototype-home-ribbon-fill"
              x1="0"
              y1="0"
              x2="1"
              y2="0.2"
            >
              <stop offset="0" stopColor="#0e66f1" stopOpacity="0" />
              <stop offset="0.2" stopColor="#2393fc" stopOpacity="0.12" />
              <stop offset="0.52" stopColor="#54daf8" stopOpacity="0.17" />
              <stop offset="0.83" stopColor="#237ce9" stopOpacity="0.09" />
              <stop offset="1" stopColor="#0e66f1" stopOpacity="0" />
            </linearGradient>
            <linearGradient
              id="prototype-home-ribbon-edge"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0" stopColor="#36bcff" stopOpacity="0" />
              <stop offset="0.48" stopColor="#71e5ff" stopOpacity="0.24" />
              <stop offset="1" stopColor="#36bcff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="prototype-home-ribbon__flow">
            <path
              d="M-120 340 C210 195 338 475 678 371 S1260 214 1720 386"
              fill="none"
              stroke="url(#prototype-home-ribbon-fill)"
              strokeWidth="95"
              strokeLinecap="round"
            />
            <path
              d="M-120 340 C210 195 338 475 678 371 S1260 214 1720 386"
              fill="none"
              stroke="url(#prototype-home-ribbon-edge)"
              strokeWidth="1.4"
            />
            <path
              d="M-110 555 C232 413 455 701 837 542 S1376 421 1730 554"
              fill="none"
              stroke="url(#prototype-home-ribbon-fill)"
              strokeWidth="68"
              strokeLinecap="round"
              opacity="0.5"
            />
          </g>
          <path
            className="prototype-home-ribbon__glint"
            d="M-120 340 C210 195 338 475 678 371 S1260 214 1720 386"
            fill="none"
            stroke="#99efff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeDasharray="145 1800"
          />
        </svg>
      </div>
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
          <PrototypeTeBookMotion />
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
