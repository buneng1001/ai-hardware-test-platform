import { useCallback, useEffect, useState } from "react";
import {
  getAiGlobalState,
  getActiveAiInvocation,
  setAiGlobalState,
  stopAiInvocationAndDisable,
  waitForAiInvocationFinish,
  type ActiveAiInvocation,
  type AiGlobalState,
} from "./aiGlobalState";

export function useAiGlobalState() {
  const [state, setState] = useState<AiGlobalState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setState(await getAiGlobalState());
    } catch {
      setState(null);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      setState(await setAiGlobalState(enabled));
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "切换 AI 状态失败");
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { state, message, busy, refresh, toggle };
}

export function AiGlobalSwitch() {
  const { state, message, busy, refresh, toggle } = useAiGlobalState();
  const [active, setActive] = useState<ActiveAiInvocation | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopMessage, setStopMessage] = useState("");

  const requestClose = async () => {
    if (!state?.enabled) return;
    setStopMessage("");
    try {
      const current = await getActiveAiInvocation();
      if (!current) {
        await toggle(false);
        return;
      }
      setActive(current);
      setDialogOpen(true);
    } catch (error) {
      setStopMessage(
        error instanceof Error ? error.message : "读取 AI 运行状态失败",
      );
    }
  };

  const confirmStop = async () => {
    if (!active || stopping) return;
    setStopping(true);
    setStopMessage("正在停止当前 AI 运行，等待本地请求结束及结果收尾…");
    try {
      await stopAiInvocationAndDisable(active.invocation_id);
      const finished = await waitForAiInvocationFinish(
        active.invocation_id,
        (next) => {
          if (next) setActive(next);
        },
      );
      if (!finished) {
        setStopMessage(
          "停止请求仍在等待中。AI 保持占用，请稍后查看状态；不会提前关闭或释放运行锁。",
        );
        return;
      }
      await refresh();
      setDialogOpen(false);
      setActive(null);
      setStopMessage("当前 AI 运行已完成停止，全局 AI 已关闭。");
    } catch (error) {
      setStopMessage(
        error instanceof Error ? error.message : "停止 AI 运行失败",
      );
      await refresh();
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="prototype-ai-global-control" aria-label="全局 AI 状态">
      <span role="status">
        AI {state === null ? "状态不可用" : state.enabled ? "已开启" : "已关闭"}
        {state?.enabled && state.provider && state.model
          ? ` · ${state.provider} / ${state.model}`
          : ""}
      </span>
      <button
        type="button"
        disabled={busy || state === null || stopping}
        onClick={() =>
          state?.enabled ? void requestClose() : void toggle(true)
        }
      >
        {state?.enabled ? "关闭 AI" : "开启 AI"}
      </button>
      {state?.reason && (
        <span className="prototype-ai-global-reason">{state.reason}</span>
      )}
      {message && <span role="alert">{message}</span>}
      {stopMessage && !dialogOpen && <span role="status">{stopMessage}</span>}
      {dialogOpen && active && (
        <div className="prototype-ai-stop-backdrop" role="presentation">
          <section
            className="prototype-ai-stop-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prototype-ai-stop-title"
          >
            <h2 id="prototype-ai-stop-title">当前有 AI 任务正在运行</h2>
            <p>
              业务操作：<strong>{active.display_name}</strong>
            </p>
            <p>
              所属项目：
              <strong>
                {active.project_name ||
                  (active.project_id
                    ? `项目 #${active.project_id}`
                    : "未关联项目")}
              </strong>
            </p>
            {active.stopping && (
              <p role="status">该任务已收到停止请求，正在完成本地收尾。</p>
            )}
            {stopMessage && <p role="status">{stopMessage}</p>}
            <div className="prototype-ai-stop-actions">
              <button
                type="button"
                disabled={stopping}
                onClick={() => void confirmStop()}
              >
                {stopping ? "正在停止…" : "停止当前的AI运行"}
              </button>
              <button
                type="button"
                className="prototype-secondary"
                disabled={stopping}
                onClick={() => {
                  setDialogOpen(false);
                  setActive(null);
                  setStopMessage("");
                }}
              >
                取消这次关闭操作
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
