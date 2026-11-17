import { INestApplication } from "@nestjs/common";
import { UserRole } from "@tms/shared";
import { api, BaseFixture, createTestApp, resetDatabase, seedBaseFixture } from "../support/app";

const { DIRECTOR, FINANCE, VOLUNTEER, DATA_ENTRY, REGISTRAR, VIEWER } = UserRole;
const GHOST_ID = "00000000-0000-4000-8000-000000000000";

/**
 * 黑箱測試：角色權限矩陣。
 * 每一列是一個 API 與「可以使用的角色」；測試會用全部 6 種角色各呼叫一次，
 * 確認允許的角色不會被 403 擋下、不允許的角色一定拿到 403。
 * （這裡只驗證權限關卡，請求內容故意留空，所以允許的角色可能拿到 400/404，那是通過權限檢查之後的事。）
 */
describe("角色權限矩陣（黑箱／HTTP API）", () => {
  let app: INestApplication;
  let fx: BaseFixture;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    fx = await seedBaseFixture(app);
  });
  afterAll(async () => {
    await app.close();
  });

  type Method = "get" | "post" | "patch" | "put" | "delete";
  // 唯讀帳號（VIEWER）不列在各端點的允許名單裡，由下面的規則統一判斷：GET 一律放行，其他一律 403
  const matrix: [Method, string, UserRole[]][] = [
    // 帳號管理
    ["get", "/auth/users", [DIRECTOR]],
    ["post", "/auth/users", [DIRECTOR]],
    // 信徒與戶籍
    ["get", "/members", [DIRECTOR, FINANCE, VOLUNTEER, DATA_ENTRY, REGISTRAR]],
    ["post", "/members", [DIRECTOR, FINANCE, VOLUNTEER, DATA_ENTRY, REGISTRAR]],
    ["patch", `/members/${GHOST_ID}`, [DIRECTOR, FINANCE, VOLUNTEER]],
    ["delete", `/members/${GHOST_ID}`, [DIRECTOR]],
    ["patch", `/households/${GHOST_ID}`, [DIRECTOR, FINANCE, VOLUNTEER]],
    ["delete", `/households/${GHOST_ID}`, [DIRECTOR]],
    // 活動
    ["get", "/ceremony/ceremonies", [DIRECTOR, FINANCE, VOLUNTEER, REGISTRAR]],
    ["post", "/ceremony/ceremonies", [DIRECTOR]],
    ["patch", `/ceremony/ceremonies/${GHOST_ID}`, [DIRECTOR]],
    ["delete", `/ceremony/ceremonies/${GHOST_ID}`, [DIRECTOR]],
    ["get", `/ceremony/ceremonies/${GHOST_ID}/seats`, [DIRECTOR, FINANCE, VOLUNTEER, REGISTRAR]],
    ["get", `/ceremony/ceremonies/${GHOST_ID}/report`, [DIRECTOR, FINANCE, VOLUNTEER]],
    ["post", "/ceremony/registrations", [DIRECTOR, FINANCE, VOLUNTEER, REGISTRAR]],
    ["post", "/activities/submit", [DIRECTOR, FINANCE, VOLUNTEER, REGISTRAR]],
    // 點燈與收據
    ["get", "/lantern/walls", [DIRECTOR, FINANCE, VOLUNTEER, REGISTRAR]],
    ["post", "/lantern/walls", [DIRECTOR]],
    ["delete", `/lantern/walls/${GHOST_ID}`, [DIRECTOR]],
    ["post", "/lantern/claims", [DIRECTOR, FINANCE, VOLUNTEER, REGISTRAR]],
    ["patch", `/lantern/claims/${GHOST_ID}`, [DIRECTOR, FINANCE, VOLUNTEER]],
    ["post", "/lantern/donations", [DIRECTOR, FINANCE, VOLUNTEER, REGISTRAR]],
    ["get", "/lantern/receipts", [DIRECTOR, FINANCE, VOLUNTEER, REGISTRAR]],
    ["post", `/lantern/receipts/${GHOST_ID}/void`, [DIRECTOR, FINANCE]],
    ["delete", `/lantern/receipts/${GHOST_ID}`, [DIRECTOR]],
    ["get", "/print/receipts/details", [DIRECTOR, FINANCE, VOLUNTEER, REGISTRAR]],
    // 庫存
    ["get", "/inventory/items", [DIRECTOR, FINANCE, VOLUNTEER]],
    ["post", "/inventory/items", [DIRECTOR]],
    ["post", `/inventory/items/${GHOST_ID}/adjust`, [DIRECTOR, FINANCE, VOLUNTEER]],
    // 財務
    ["post", "/finance/ledger-entries", [DIRECTOR, FINANCE, VOLUNTEER]],
    ["get", "/finance/ledger-entries", [DIRECTOR, FINANCE]],
    ["post", `/finance/ledger-entries/${GHOST_ID}/review`, [DIRECTOR, FINANCE]],
    ["post", "/finance/ledger-entries/batch-review", [DIRECTOR, FINANCE]],
    ["get", "/finance/reports/daily?date=2026-01-01", [DIRECTOR, FINANCE, REGISTRAR]],
    ["get", "/finance/reports/monthly?year=2026&month=1", [DIRECTOR, FINANCE]],
    ["get", "/finance/reports/annual?year=2026", [DIRECTOR, FINANCE]],
    // 設定
    ["get", "/temples", [DIRECTOR, FINANCE, VOLUNTEER, REGISTRAR]],
    ["get", `/settings/${GHOST_ID}`, [DIRECTOR, FINANCE, VOLUNTEER]],
    ["put", `/settings/${GHOST_ID}`, [DIRECTOR]],
  ];

  describe.each(matrix)("%s %s", (method, path, allowed) => {
    it.each(Object.values(UserRole))("%s", async (role) => {
      const res = await api(app, fx.tokens[role])[method](path);
      const shouldPass = role === VIEWER ? method === "get" : allowed.includes(role);
      if (shouldPass) {
        expect(res.status).not.toBe(403);
        expect(res.status).not.toBe(401);
      } else {
        expect(res.status).toBe(403);
      }
    });

    it("未登入一律 401", async () => {
      const res = await api(app)[method](path);
      expect(res.status).toBe(401);
    });
  });

  it("唯讀帳號被擋下時的訊息說明原因", async () => {
    const res = await api(app, fx.tokens[VIEWER]).post("/members", { householdAddress: "A", name: "甲", gender: "MALE" }).expect(403);
    expect(res.body.message).toBe("此帳號為唯讀帳號，無法執行此操作");
  });
});
