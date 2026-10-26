import { expect, test } from "vitest";

const nodeFileSystemModule: string = "node:fs";
const { readFileSync } = await import(/* @vite-ignore */ nodeFileSystemModule);
const testProcess = (
  globalThis as typeof globalThis & { process: { cwd: () => string } }
).process;
const styles = [
  "V020PrototypeTheme.css",
  "V020PrototypeWorkspace.css",
  "V020PrototypeComponents.css",
  "V020PrototypeCases.css",
  "V020PrototypeResponsive.css",
]
  .map((file) => readFileSync(`${testProcess.cwd()}/src/${file}`, "utf8"))
  .join("\n");

function declarations(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`找不到样式规则：${selector}`);
  return match[1];
}

test("V020 页面使用完整画布、设计变量和可折叠侧栏", () => {
  for (const selector of [".prototype-home", ".prototype-shell"]) {
    expect(declarations(selector)).toContain("width: 100%");
  }

  expect(declarations(".prototype-projects")).toContain(
    "width: min(100%, 1600px)",
  );

  expect(declarations(".prototype-shell--sidebar")).toContain(
    "grid-template-columns: var(--prototype-sidebar-width) minmax(0, 1fr)",
  );
  expect(declarations(".prototype-page")).toContain(
    "--prototype-color-canvas:",
  );
  expect(declarations(".prototype-shell--collapsed")).toContain(
    "--prototype-sidebar-width: 88px",
  );
  expect(declarations(".prototype-shell")).toContain("border: 0");
});

test("窄窗口保留切换项目和返回首页入口", () => {
  const responsiveStyles = readFileSync(
    `${testProcess.cwd()}/src/V020PrototypeResponsive.css`,
    "utf8",
  );

  expect(responsiveStyles).toMatch(
    /\.prototype-sidebar-exit\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*row;/s,
  );
  expect(responsiveStyles).not.toMatch(
    /\.prototype-sidebar-toggle,\s*\.prototype-sidebar-exit\s*\{/,
  );
});

test("主操作按钮统一使用绿色品牌色", () => {
  expect(declarations(".prototype-page button")).toContain(
    "background: var(--prototype-color-brand)",
  );
  expect(declarations(".prototype-primary")).toContain(
    "background: var(--prototype-color-brand)",
  );
});

test("报告指标悬停保持可读且测试数据筛选控件留有间距", () => {
  expect(
    declarations(".prototype-page button.prototype-metric-button:hover"),
  ).toContain("background: var(--prototype-color-brand-soft)");
  expect(declarations(".prototype-data-toolbar")).toContain("gap: 16px");
});

test("页面切换使用轻量进入动效", () => {
  expect(declarations(".prototype-screen-transition")).toContain(
    "animation: prototype-screen-enter",
  );
});
