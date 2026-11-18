import { INestApplication } from "@nestjs/common";
import { CeremonyFeeMode, DonationType, UserRole } from "@tms/shared";
import { api, BaseFixture, createTestApp, resetDatabase, seedBaseFixture } from "../support/app";

/**
 * 黑箱測試：操作紀錄（/audit-logs）。
 * 合併列出收據開立／作廢，以及建立／修改／刪除活動、永久刪除收據；只有總幹事（與唯讀帳號）看得到。
 */
describe("操作紀錄（黑箱／HTTP API）", () => {
  let app: INestApplication;
  let fx: BaseFixture;
  let director: ReturnType<typeof api>;
  let volunteer: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    fx = await seedBaseFixture(app);
    director = api(app, fx.tokens[UserRole.DIRECTOR]);
    volunteer = api(app, fx.tokens[UserRole.VOLUNTEER]);
  });
  afterAll(async () => {
    await app.close();
  });

  const logs = async (query = "") => (await director.get(`/audit-logs${query}`).expect(200)).body;
  const createCeremony = async (overrides: Record<string, unknown> = {}) =>
    (
      await director
        .post("/ceremony/ceremonies", {
          templeId: fx.templeId,
          name: "中元普渡",
          date: "2099-08-01",
          feeMode: CeremonyFeeMode.FREE_WILL,
          ...overrides,
        })
        .expect(201)
    ).body;
  const donate = async (amount = 1000) =>
    (
      await volunteer
        .post("/lantern/donations", { templeId: fx.templeId, walkInName: "善心人士", type: DonationType.GENERAL, amount })
        .expect(201)
    ).body.receipt;

  it("建立、修改、刪除活動都會留下紀錄；修改只列出真的有變的欄位；沒有變更就不記", async () => {
    const c = await createCeremony();
    await director.patch(`/ceremony/ceremonies/${c.id}`, { name: "中元普渡法會", date: "2099-08-02" }).expect(200);
    await director.patch(`/ceremony/ceremonies/${c.id}`, { name: "中元普渡法會" }).expect(200); // 沒變
    await director.delete(`/ceremony/ceremonies/${c.id}`).expect(200);

    const { items, total } = await logs();
    expect(total).toBe(3);
    expect(items.map((i: { action: string; summary: string }) => [i.action, i.summary])).toEqual([
      ["CEREMONY_DELETE", "刪除餐會「中元普渡法會」（2099-08-02）"],
      ["CEREMONY_UPDATE", "修改活動「中元普渡法會」：名稱：中元普渡 → 中元普渡法會；日期：2099-08-01 → 2099-08-02"],
      ["CEREMONY_CREATE", "建立餐會「中元普渡」（2099-08-01）"],
    ]);
    expect(items.every((i: { userName: string }) => i.userName === "測試-DIRECTOR")).toBe(true);
  });

  it("收據開立與作廢合併列出，帶收據編號、金額與作廢原因；可依操作種類篩選", async () => {
    const receipt = await donate(1200);
    await api(app, fx.tokens[UserRole.FINANCE]).post(`/lantern/receipts/${receipt.id}/void`, { reason: "金額打錯" }).expect(201);

    const all = await logs();
    expect(all.items.map((i: { action: string }) => i.action)).toEqual(["RECEIPT_VOID", "RECEIPT_ISSUE"]);
    expect(all.items[0]).toMatchObject({ userName: "測試-FINANCE" });
    expect(all.items[0].summary).toBe(`收據 ${receipt.receiptNo}　NT$ 1,200　原因：金額打錯`);
    expect(all.items[1]).toMatchObject({ userName: "測試-VOLUNTEER", summary: `收據 ${receipt.receiptNo}　NT$ 1,200` });

    const voids = await logs("?action=RECEIPT_VOID");
    expect(voids.total).toBe(1);
  });

  it("永久刪除收據：收據和它的開立紀錄都不見了，但操作紀錄留下收據編號與金額", async () => {
    const receipt = await donate(800);
    await director.delete(`/lantern/receipts/${receipt.id}`).expect(200);
    const { items } = await logs();
    expect(items.map((i: { action: string }) => i.action)).toEqual(["RECEIPT_DELETE"]);
    expect(items[0].summary).toBe(`永久刪除收據 ${receipt.receiptNo}　NT$ 800　善心人士（正常）`);
  });

  it("分頁與日期篩選：今天的查得到，昨天以前的查不到；日期格式錯誤 400", async () => {
    for (let i = 0; i < 3; i++) await donate(100 + i);
    const page1 = await logs("?page=1&pageSize=2");
    const page2 = await logs("?page=2&pageSize=2");
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
    expect(new Set([...page1.items, ...page2.items].map((i: { id: string }) => i.id)).size).toBe(3);

    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
    expect((await logs(`?from=${today}&to=${today}`)).total).toBe(3);
    expect((await logs("?from=2000-01-01&to=2000-01-31")).total).toBe(0);
    await director.get("/audit-logs?from=2026-13-01").expect(400);
  });

  it("只有總幹事與唯讀帳號看得到", async () => {
    await api(app, fx.tokens[UserRole.VIEWER]).get("/audit-logs").expect(200);
    for (const role of [UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.REGISTRAR, UserRole.DATA_ENTRY]) {
      await api(app, fx.tokens[role]).get("/audit-logs").expect(403);
    }
    await api(app).get("/audit-logs").expect(401);
  });
});
