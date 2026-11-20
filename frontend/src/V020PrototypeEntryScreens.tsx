import { useAiGlobalState } from "./AiGlobalSwitch";
import { PROTOTYPE_BRAND } from "./V020PrototypeBrand";
import { PrototypeBrandGlyph } from "./V020PrototypeBrandGlyph";
import { PrototypeAiConfiguration } from "./V020PrototypeAiConfiguration";

export function PrototypeHome({
  onOpenProjects,
}: {
  onOpenProjects: () => void;
}) {
  const { state, message, busy, toggle } = useAiGlobalState();
  const openWithAi = () => {
    // 平台的非 AI 业务不受准入拒绝影响；开关仅控制 AI 能力。
    if (!state?.enabled) void toggle(true);
    onOpenProjects();
  };
  const skipAi = () => {
    // 即便后端暂不可用，也允许进入不依赖 AI 的工作区。
    void toggle(false);
    onOpenProjects();
  };
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
          <PrototypeBrandGlyph
            className="prototype-home-brand-motion"
            testId="prototype-home-brand-motion"
          />
        </div>
        <div className="prototype-home-capabilities">
          <span>项目管理</span>
          <span>自动化测试</span>
          <span>测试数据</span>
          <span>报告分析</span>
        </div>
        <button
          className="prototype-primary"
          disabled={busy}
          onClick={openWithAi}
        >
          开启平台 <span aria-hidden="true">→</span>
        </button>
        <span>AI {state?.enabled ? "已开启" : "已关闭"}</span>
        {message && <p role="alert">{message}</p>}
      </div>
      <PrototypeAiConfiguration onSkip={skipAi} />
    </div>
  );
}
