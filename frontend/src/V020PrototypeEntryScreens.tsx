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
              id="prototype-home-ribbon-azure"
              x1="-120"
              y1="0"
              x2="1720"
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor="#1f7dda" stopOpacity="0" />
              <stop offset="0.18" stopColor="#247fd8" stopOpacity="0.6" />
              <stop offset="0.43" stopColor="#57c6ff" stopOpacity="0.95" />
              <stop offset="0.68" stopColor="#66d7fa" stopOpacity="0.72" />
              <stop offset="0.87" stopColor="#3188da" stopOpacity="0.53" />
              <stop offset="1" stopColor="#1f7dda" stopOpacity="0" />
            </linearGradient>
            <linearGradient
              id="prototype-home-ribbon-deep"
              x1="-120"
              y1="0"
              x2="1720"
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor="#0e53bc" stopOpacity="0" />
              <stop offset="0.24" stopColor="#277de0" stopOpacity="0.52" />
              <stop offset="0.61" stopColor="#418dff" stopOpacity="0.92" />
              <stop offset="0.82" stopColor="#155fbb" stopOpacity="0.5" />
              <stop offset="1" stopColor="#0e53bc" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="prototype-home-ribbon__flow">
            <g className="prototype-home-ribbon__strand">
              <path
                d="M-140 394 C155 343 302 303 524 349 S935 442 1205 361 S1533 311 1730 351"
                fill="none"
                stroke="url(#prototype-home-ribbon-azure)"
                strokeWidth="82"
                opacity="0.2"
              />
              <path
                d="M-140 394 C155 343 302 303 524 349 S935 442 1205 361 S1533 311 1730 351"
                fill="none"
                stroke="url(#prototype-home-ribbon-azure)"
                strokeWidth="19"
                opacity="0.28"
              />
              <path
                d="M-140 394 C155 343 302 303 524 349 S935 442 1205 361 S1533 311 1730 351"
                fill="none"
                stroke="url(#prototype-home-ribbon-azure)"
                strokeWidth="2.3"
                opacity="0.64"
              />
            </g>
            <g className="prototype-home-ribbon__strand">
              <path
                d="M-130 473 C178 429 368 520 693 459 S1150 397 1730 460"
                fill="none"
                stroke="url(#prototype-home-ribbon-deep)"
                strokeWidth="38"
                opacity="0.32"
              />
              <path
                d="M-130 473 C178 429 368 520 693 459 S1150 397 1730 460"
                fill="none"
                stroke="url(#prototype-home-ribbon-deep)"
                strokeWidth="2.6"
                opacity="0.7"
              />
            </g>
            <g className="prototype-home-ribbon__strand">
              <path
                d="M-120 552 C172 509 433 589 731 534 S1270 480 1730 541"
                fill="none"
                stroke="url(#prototype-home-ribbon-azure)"
                strokeWidth="15"
                opacity="0.22"
              />
              <path
                d="M-120 552 C172 509 433 589 731 534 S1270 480 1730 541"
                fill="none"
                stroke="url(#prototype-home-ribbon-azure)"
                strokeWidth="1.6"
                opacity="0.58"
              />
            </g>
            <g className="prototype-home-ribbon__strand">
              <path
                d="M-130 611 C214 583 456 665 789 588 S1302 539 1730 602"
                fill="none"
                stroke="url(#prototype-home-ribbon-deep)"
                strokeWidth="7"
                opacity="0.27"
              />
              <path
                d="M-130 611 C214 583 456 665 789 588 S1302 539 1730 602"
                fill="none"
                stroke="url(#prototype-home-ribbon-deep)"
                strokeWidth="1"
                opacity="0.45"
              />
            </g>
          </g>
          <g className="prototype-home-ribbon__glint">
            <path
              d="M-140 394 C155 343 302 303 524 349 S935 442 1205 361 S1533 311 1730 351"
              pathLength="1000"
              fill="none"
              stroke="#4bcfff"
              strokeWidth="11"
              strokeDasharray="118 882"
              opacity="0.32"
            />
            <path
              d="M-140 394 C155 343 302 303 524 349 S935 442 1205 361 S1533 311 1730 351"
              pathLength="1000"
              fill="none"
              stroke="#c4faff"
              strokeWidth="2.5"
              strokeDasharray="118 882"
            />
          </g>
          <g className="prototype-home-ribbon__glint prototype-home-ribbon__glint--second">
            <path
              d="M-130 473 C178 429 368 520 693 459 S1150 397 1730 460"
              pathLength="1000"
              fill="none"
              stroke="#5aaaff"
              strokeWidth="8"
              strokeDasharray="90 910"
              opacity="0.23"
            />
            <path
              d="M-130 473 C178 429 368 520 693 459 S1150 397 1730 460"
              pathLength="1000"
              fill="none"
              stroke="#b4eaff"
              strokeWidth="1.7"
              strokeDasharray="90 910"
            />
          </g>
          <g className="prototype-home-ribbon__specks" fill="#a5e9ff">
            <circle cx="256" cy="346" r="2.2" />
            <circle cx="283" cy="361" r="1.1" opacity="0.55" />
            <circle cx="470" cy="432" r="1.7" opacity="0.6" />
            <circle cx="812" cy="416" r="1.3" />
            <circle cx="1039" cy="449" r="2.7" opacity="0.65" />
            <circle cx="1320" cy="332" r="1.6" />
            <circle cx="348" cy="550" r="1.4" opacity="0.62" />
            <circle cx="735" cy="551" r="2.2" />
            <circle cx="1252" cy="541" r="1.1" opacity="0.6" />
            <circle cx="1470" cy="578" r="2" opacity="0.72" />
            <circle cx="1039" cy="449" r="8" fill="#39b5ff" opacity="0.1" />
            <circle cx="256" cy="346" r="8" fill="#6adfff" opacity="0.13" />
            <circle cx="735" cy="551" r="7" fill="#69d7ff" opacity="0.12" />
          </g>
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
