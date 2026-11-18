import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 匯出報表的時間依台灣時間格式化，測試固定用台灣時區，換到 UTC 的機器（例如 CI）結果也一樣
process.env.TZ = "Asia/Taipei";

/** 前端單元測試：在 jsdom 裡渲染元件，直接讀 shared 的原始碼（不需要先 build） */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@tms/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    css: false,
  },
});
