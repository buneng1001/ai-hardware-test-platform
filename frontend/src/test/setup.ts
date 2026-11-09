import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

/**
 * 每个测试结束后清空浏览器存储。
 * 冻结版首页会把导航位置和 AI 模型目录写入本地存储，不清空会串到下一个用例。
 */
afterEach(() => {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // 没有可用的存储时无需处理。
  }
});
