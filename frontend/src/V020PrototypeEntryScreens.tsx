import { useState } from "react";
import { useAiGlobalState } from "./AiGlobalSwitch";
import {
  getActiveAiInvocation,
  stopAiInvocationAndDisable,
  waitForAiInvocationFinish,
  type ActiveAiInvocation,
} from "./aiGlobalState";
import { V020ConfirmDialog } from "./V020ConfirmDialog";
import { PROTOTYPE_BRAND } from "./V020PrototypeBrand";
import { PrototypeBrandGlyph } from "./V020PrototypeBrandGlyph";
import { PrototypeAiConfiguration } from "./V020PrototypeAiConfiguration";

export function PrototypeHome({
  onOpenProjects,
}: {
  onOpenProjects: () => void;
}) {
  const { state, message, busy, toggle, refresh } = useAiGlobalState();
  const [active, setActive] = useState<ActiveAiInvocation | null>(null);
  const [stopping, setStopping] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const skipAi = async () => {
    setCloseError("");
    if (!state?.enabled) {
      onOpenProjects();
      return;
    }
    try {
      const current = await getActiveAiInvocation();
      if (current) {
        setActive(current);
        return;
      }
      if (await toggle(false)) onOpenProjects();
    } catch (error) {
      setCloseError(
        error instanceof Error ? error.message : "读取 AI 运行状态失败",
      );
    }
  };
  const confirmStop = async () => {
    if (!active || stopping) return;
    setStopping(true);
    setCloseError("");
    try {
      await stopAiInvocationAndDisable(active.invocation_id);
      if (!(await waitForAiInvocationFinish(active.invocation_id))) {
        setCloseError("停止尚未完成，请稍后查看运行状态。");
        return;
      }
      await refresh();
      setActive(null);
      onOpenProjects();
    } catch (error) {
      setCloseError(
        error instanceof Error ? error.message : "停止 AI 运行失败",
      );
    } finally {
      setStopping(false);
    }
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
        <div className="prototype-home-launch">
          <button
            className="prototype-primary"
            disabled={busy || stopping || configurationBusy}
            onClick={onOpenProjects}
          >
            开启平台 <span aria-hidden="true">→</span>
          </button>
          <span
            className={`prototype-home-ai-state${state?.enabled ? " is-enabled" : ""}`}
            role="status"
          >
            AI{" "}
            {state === null
              ? "状态不可用"
              : state.enabled
                ? "已开启"
                : "已关闭"}
          </span>
        </div>
        {message && <p role="alert">{message}</p>}
        {closeError && !active && <p role="alert">{closeError}</p>}
      </div>
      <PrototypeAiConfiguration
        onSkip={() => void skipAi()}
        aiEnabled={state?.enabled === true}
        onStateChanged={refresh}
        onBusyChange={setConfigurationBusy}
        skipBusy={busy || stopping}
      />
      {active && (
        <V020ConfirmDialog
          ariaLabel="关闭 AI 确认"
          title="当前有 AI 任务正在运行"
          confirmLabel="停止当前的AI运行"
          cancelLabel="取消这次关闭操作"
          busy={stopping}
          onCancel={() => {
            setActive(null);
            setCloseError("");
          }}
          onConfirm={() => void confirmStop()}
        >
          <p>业务操作：{active.display_name}</p>
          <p>
            所属项目：
            {active.project_name ||
              (active.project_id ? `项目 #${active.project_id}` : "未关联项目")}
          </p>
          {closeError && <p role="alert">{closeError}</p>}
        </V020ConfirmDialog>
      )}
    </div>
  );
}
