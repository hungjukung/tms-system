import { defineConfig, devices } from "@playwright/test";

const API_PORT = 3101;
const WEB_PORT = 5274;

/**
 * End-to-End 測試：用真的瀏覽器操作前端畫面，前端接到測試專用的後端與臨時資料庫（不會碰到開發或正式資料）。
 * 執行前需要先 build 過 shared 與 api（根目錄的 pnpm test:e2e 會自動做）。
 */
export default defineConfig({
  testDir: "./e2e",
  // 所有測試共用同一個資料庫，依序執行避免互相干擾
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  outputDir: "e2e-results",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node apps/api/test/support/e2e-server.js",
      url: `http://localhost:${API_PORT}/api/temples`,
      // 沒登入會回 401，代表伺服器已經起來了
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { E2E_API_PORT: String(API_PORT) },
    },
    {
      // --force：每次都重新預先打包相依套件。共用套件（@tms/shared）新增匯出時，舊的打包快取裡沒有，
      // 前端會整個載入失敗（所有測試一起逾時），強制重建可避免沿用過期快取
      command: "pnpm --filter @tms/web exec vite --port " + WEB_PORT + " --strictPort --force",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});
