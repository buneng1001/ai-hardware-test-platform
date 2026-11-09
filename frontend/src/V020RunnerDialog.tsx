import { useState } from "react";

import type { MockRunner, RunnerKind } from "./mockRunners";
import {
  readRunners,
  runnerKindLabels,
  saveRunners,
  simulateConnection,
} from "./mockRunners";

/**
 * 执行器管理弹窗（演示版）：三种模式 + 测试连接 + 保存。
 * 目前不发起真实网络请求，只做界面与本地状态演示。
 */
export function V020RunnerDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [runners, setRunners] = useState<MockRunner[]>(() => readRunners());
  const [kind, setKind] = useState<RunnerKind>("github");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [token, setToken] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);

  if (!open) return null;

  const reset = () => {
    setName("");
    setTarget("");
    setToken("");
    setCheck(null);
  };

  const runCheck = () => {
    setChecking(true);
    setCheck(null);
    // 模拟网络往返，让“测试连接”有可见的等待态。
    window.setTimeout(() => {
      setCheck(simulateConnection({ kind, target, token }));
      setChecking(false);
    }, 600);
  };

  const save = () => {
    if (!check?.ok) return;
    const next: MockRunner[] = [
      ...runners,
      {
        id: `runner-${Date.now()}`,
        kind,
        name: name.trim() || runnerKindLabels[kind],
        target: target.trim(),
        connected: true,
        lastMessage: check.message,
      },
    ];
    setRunners(next);
    saveRunners(next);
    reset();
  };

  return (
    <div className="prototype-modal-backdrop">
      <section
        aria-label="执行器管理"
        aria-modal="true"
        className="prototype-modal prototype-runner-modal"
        role="dialog"
      >
        <h3>执行器（怎么跑自动化）</h3>
        <p className="prototype-muted">
          先选模式、测试连接，保存后就能在测试组里选它。当前是演示版，连接测试不会真的访问外部服务。
        </p>

        <div className="prototype-runner-tabs" role="tablist">
          {(Object.keys(runnerKindLabels) as RunnerKind[]).map((item) => (
            <button
              aria-pressed={kind === item}
              className={
                kind === item
                  ? "prototype-runner-tab is-selected"
                  : "prototype-runner-tab"
              }
              key={item}
              onClick={() => {
                setKind(item);
                setCheck(null);
              }}
              role="tab"
              type="button"
            >
              {runnerKindLabels[item]}
            </button>
          ))}
        </div>

        <label>
          执行器名称
          <input
            aria-label="执行器名称"
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：回归流水线"
            value={name}
          />
        </label>

        <label>
          {kind === "github"
            ? "仓库与工作流（owner/repo/workflow.yml）"
            : kind === "jenkins"
              ? "Jenkins 地址"
              : "本地项目目录"}
          <input
            aria-label="执行器地址"
            onChange={(event) => setTarget(event.target.value)}
            placeholder={
              kind === "github"
                ? "iris/headcam-tests/.github/workflows/regression.yml"
                : kind === "jenkins"
                  ? "http://jenkins.local:8080"
                  : "D:/work/iris-autotest"
            }
            value={target}
          />
        </label>

        {kind !== "local" && (
          <label>
            访问令牌
            <input
              aria-label="访问令牌"
              onChange={(event) => setToken(event.target.value)}
              placeholder={kind === "github" ? "ghp_..." : "Jenkins API Token"}
              type="password"
              value={token}
            />
          </label>
        )}

        <div className="prototype-actions">
          <button
            className="prototype-secondary"
            disabled={checking}
            onClick={runCheck}
            type="button"
          >
            {checking ? "连接中…" : "测试连接"}
          </button>
          <button
            className="prototype-primary"
            disabled={!check?.ok}
            onClick={save}
            type="button"
          >
            保存执行器
          </button>
          <button
            className="prototype-secondary"
            onClick={() => {
              reset();
              onClose();
            }}
            type="button"
          >
            关闭
          </button>
        </div>

        {check && (
          <p
            className={
              check.ok
                ? "prototype-runner-check is-ok"
                : "prototype-runner-check is-fail"
            }
            role="status"
          >
            {check.ok ? "✓ " : "✕ "}
            {check.message}
          </p>
        )}

        <h4>已保存的执行器</h4>
        {runners.length === 0 ? (
          <p className="prototype-muted">还没有执行器。</p>
        ) : (
          <ul className="prototype-runner-list">
            {runners.map((runner) => (
              <li key={runner.id}>
                <strong>{runner.name}</strong>
                <span className="prototype-muted">
                  {runnerKindLabels[runner.kind]} · {runner.target}
                </span>
                <span
                  className={
                    runner.connected
                      ? "prototype-runner-dot is-ok"
                      : "prototype-runner-dot is-fail"
                  }
                >
                  {runner.connected ? "已连接" : "未连接"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
