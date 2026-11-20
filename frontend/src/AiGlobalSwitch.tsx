import { useCallback, useEffect, useState } from "react";
import {
  getAiGlobalState,
  setAiGlobalState,
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
    // 其他标签页、配置页均以服务端状态为准，不缓存权威开关。
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
      const next = await setAiGlobalState(enabled);
      setState(next);
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
  const { state, message, busy, toggle } = useAiGlobalState();
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
        disabled={busy || state === null}
        onClick={() => void toggle(!state?.enabled)}
      >
        {state?.enabled ? "关闭 AI" : "开启 AI"}
      </button>
      {state?.reason && (
        <span className="prototype-ai-global-reason">{state.reason}</span>
      )}
      {message && <span role="alert">{message}</span>}
    </div>
  );
}
