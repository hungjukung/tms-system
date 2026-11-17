import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 開發伺服器把 API 轉給後端；E2E 測試會用 VITE_PROXY_TARGET 指到測試專用的後端
const apiTarget = process.env.VITE_PROXY_TARGET ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["@tms/shared"],
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/socket.io": {
        target: apiTarget,
        ws: true,
      },
      "/uploads": {
        target: apiTarget,
      },
    },
  },
});
