# 測試說明

所有測試都在本機執行，使用「測試專用的臨時 PostgreSQL」（embedded-postgres，不需要 Docker），
資料只存在作業系統的暫存資料夾，**不會碰到開發資料庫或正式環境**。

## 怎麼跑

第一次先安裝：`pnpm install`，E2E 另外需要 `npx playwright install chromium`。

| 指令（在專案根目錄） | 內容 | 約需時間 |
| --- | --- | --- |
| `pnpm test:unit` | 後端白箱單元測試 + 前端單元測試 | 30 秒 |
| `pnpm test:integration` | 後端整合／黑箱測試（真的 HTTP + 真的資料庫） | 1.5 分鐘 |
| `pnpm test:e2e` | End-to-End（真的瀏覽器操作畫面） | 1.5 分鐘 |
| `pnpm test` | 以上全部 | 4 分鐘 |
| `pnpm test:cov` | 後端測試 + 覆蓋率報告（`apps/api/coverage/`） | 2 分鐘 |

E2E 失敗時，`e2e-report/` 有 HTML 報告，`e2e-results/` 有截圖與操作錄影（trace）。

## 測試分層

| 種類 | 位置 | 做法 |
| --- | --- | --- |
| **Unit／白箱** | `apps/api/test/unit/` | 資料庫用 mock，照程式內部的 if／迴圈／try-catch 分支逐一設計案例，包含從外部走不到的路徑（例如取號連續撞號 5 次、自動配位遇到被手動選走的座位） |
| **Unit（前端）** | `apps/web/test/` | 遊覽車座位圖、民國年生日輸入、匯入檔解析等元件與工具函式 |
| **Integration／黑箱** | `apps/api/test/integration/` | 啟動整個後端接上真的 PostgreSQL，只透過 HTTP API 驗證；案例用等價分割與邊界值設計（例如人數上限的第 N 位與第 N+1 位） |
| **權限矩陣** | `integration/rbac.int-spec.ts` | 39 個 API × 6 種角色 + 未登入，逐一確認該放行或該擋下 |
| **Migration** | `integration/migrations.int-spec.ts` | 從空資料庫跑完所有 migration，確認結果與 entity 定義一致（防止改了 entity 忘了寫 migration） |
| **End-to-End** | `e2e/` | Playwright 開瀏覽器：登入 → 建立活動 → 報名選位 → 開立收據，檢查收據列印視窗的內容 |

## 已知問題的標記方式

目前沒有尚未修正的已知問題。之後如果測試發現問題但暫時不修，用 `it.failing`（後端）或 `test.fail`（E2E）標記：
現在如預期失敗、整體仍是綠燈；修好之後測試會意外通過而被判定失敗，提醒把標記拿掉，變成正式的回歸測試。
規則還沒確認的項目用 `it.todo` 記錄。
