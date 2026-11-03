import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** Vite 配置文件运行在 Node 环境，这里声明最小的 process 类型，避免引入 @types/node。 */
declare const process: { env: Record<string, string | undefined> };

/**
 * 开发代理目标从环境变量读取，默认 8020（比 8000 更不容易和其它项目撞车）。
 * 需要换端口时设置 VITE_API_PROXY_TARGET（环境变量或 .env.development），
 * 不需要改这段代码；scripts/dev.ps1 会自动挑空闲端口并写好这个变量。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const proxyTarget =
    process.env.VITE_API_PROXY_TARGET ||
    env.VITE_API_PROXY_TARGET ||
    "http://127.0.0.1:8020";
  return {
    plugins: [react()],
    server: {
      // 固定 IPv4：否则 Windows 只监听 ::1，浏览器打开 127.0.0.1 会被拒绝。
      host: "127.0.0.1",
      proxy: {
        "/api": proxyTarget,
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
    },
  };
});
