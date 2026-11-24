import { useEffect, useRef, useState } from "react";

/** A cached row is not navigation authority: resolve its live relation before opening. */
export function SourceRelationLink({
  versionId,
  automationId,
  sourceId,
  label,
  onOpen,
}: {
  versionId: number;
  automationId: number;
  sourceId: number | null | undefined;
  label: string;
  onOpen: (sourceId: number) => void;
}) {
  const [state, setState] = useState<
    "ready" | "loading" | "unavailable" | "error"
  >("ready");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    setState("ready");
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [versionId, automationId, sourceId]);

  const valid =
    typeof sourceId === "number" &&
    Number.isSafeInteger(sourceId) &&
    sourceId > 0 &&
    Boolean(label);
  const resolve = async () => {
    if (!valid || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setState("loading");
    const timeout = window.setTimeout(() => {
      if (pending.current !== controller) return;
      pending.current = null;
      controller.abort();
      setState("error");
    }, 8000);
    try {
      const response = await fetch(
        `/api/product-versions/${versionId}/automation-test-cases/${automationId}/source-relation`,
        { signal: controller.signal, cache: "no-store" },
      );
      if (pending.current !== controller) return;
      if ([401, 403, 404, 410].includes(response.status)) {
        setState("unavailable");
        return;
      }
      if (!response.ok) throw new Error("relation");
      const target = await response.json();
      if (pending.current !== controller) return;
      if (
        target?.source_test_case_id !== sourceId ||
        target?.product_version_id !== versionId
      ) {
        setState("unavailable");
        return;
      }
      setState("ready");
      onOpen(sourceId);
    } catch {
      if (pending.current === controller) setState("error");
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === controller) pending.current = null;
    }
  };

  if (!valid || state === "unavailable")
    return <span className="prototype-muted">来源用例不可用</span>;
  if (state === "loading")
    return (
      <span role="status" className="prototype-muted">
        关联信息加载中…
      </span>
    );
  if (state === "error")
    return (
      <span className="prototype-muted">
        关联信息加载失败，请重试{" "}
        <button
          type="button"
          className="prototype-secondary"
          onClick={() => void resolve()}
        >
          重试
        </button>
      </span>
    );
  return (
    <a
      className="prototype-source-relation-link"
      href={`#source-test-case-${sourceId}`}
      onClick={(event) => {
        event.preventDefault();
        void resolve();
      }}
    >
      {label}
    </a>
  );
}
