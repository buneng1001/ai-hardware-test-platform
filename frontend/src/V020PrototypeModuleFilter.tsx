import { useEffect, useId, useRef, useState } from "react";

import type { CaseModuleFilter } from "./V020PrototypeShared";

const moduleOptions: ReadonlyArray<{
  value: CaseModuleFilter;
  label: string;
}> = [
  { value: "all", label: "全部模块" },
  { value: "录制功能", label: "录制功能" },
  { value: "电源管理", label: "电源管理" },
];

export function PrototypeModuleFilter({
  value,
  onChange,
}: {
  value: CaseModuleFilter;
  onChange: (value: CaseModuleFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel =
    moduleOptions.find((option) => option.value === value)?.label ?? "全部模块";

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  return (
    <div className="prototype-module-filter" ref={rootRef}>
      <span className="prototype-module-filter-label">用例模块</span>
      <button
        className="prototype-module-filter-trigger"
        type="button"
        role="combobox"
        aria-label="用例模块"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{selectedLabel}</span>
        <span className="prototype-module-filter-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <div
          className="prototype-module-filter-list"
          id={listboxId}
          role="listbox"
          aria-label="用例模块"
        >
          {moduleOptions.map((option) => (
            <button
              key={option.value}
              className={option.value === value ? "is-selected" : ""}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
