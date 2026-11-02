import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** Vite 配置文件运行在 Node 环境，这里声明最小的 process 类型，避免引入 @types/node。 */
declare const process: { env: Record<string, string | undefined> };

/**
 * 开发代理目标从环境变量读取，默认 8000。
 * 端口被占用时只需设置 VITE_API_PROXY_TARGET（环境变量或在 .env.development 里），
 * 不需要改这段代码。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const proxyTarget =
    process.env.VITE_API_PROXY_TARGET ||
    env.VITE_API_PROXY_TARGET ||
    "http://127.0.0.1:8000";
  return {
    plugins: [react()],
    server: {
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
