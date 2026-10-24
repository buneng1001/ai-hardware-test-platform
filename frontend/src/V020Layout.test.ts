import { expect, test } from "vitest";

const nodeFileSystemModule: string = "node:fs";
const { readFileSync } = await import(/* @vite-ignore */ nodeFileSystemModule);
const testProcess = (
  globalThis as typeof globalThis & { process: { cwd: () => string } }
).process;
const styles = readFileSync(`${testProcess.cwd()}/src/styles.css`, "utf8");

function declarations(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`找不到样式规则：${selector}`);
  return match[1];
}

test("V020 大屏页面使用完整可用宽度并按比例分配侧栏", () => {
  for (const selector of [
    ".prototype-home",
    ".prototype-projects",
    ".prototype-shell",
  ]) {
    expect(declarations(selector)).toContain("width: 100%");
  }

  expect(declarations(".prototype-shell--sidebar")).toContain(
    "grid-template-columns: minmax(220px, 16%) minmax(0, 1fr)",
  );
});
