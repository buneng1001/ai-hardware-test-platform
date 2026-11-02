import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * 开发代理目标从环境变量读取，默认 8000。
 * 端口被占用时只需在 frontend/.env.development 里改 VITE_API_PROXY_TARGET，
 * 或启动前端时临时设置该环境变量，不需要改这段代码。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";
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
