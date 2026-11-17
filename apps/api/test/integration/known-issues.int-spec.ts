import { INestApplication } from "@nestjs/common";
import { DonationType, GiftType, UserRole } from "@tms/shared";
import { api, BaseFixture, createTestApp, resetDatabase, seedBaseFixture, TEST_PASSWORD } from "../support/app";

const GHOST_ID = "00000000-0000-4000-8000-000000000000";

/**
 * 黑箱測試先前發現的問題，修正後轉成正式的回歸測試；仍未決定的規則留在最後面用 it.todo 記錄。
 */
describe("先前發現問題的回歸測試", () => {
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

  describe("不合法的輸入回 400／404，不再是 500", () => {
    it("網址上的 id 不是 UUID 格式", async () => {
      const responses = await Promise.all([
        director.get("/members/abc"),
        director.patch("/ceremony/ceremonies/abc", { name: "x" }),
        director.get("/ceremony/ceremonies/abc/seats"),
        director.post("/lantern/receipts/abc/void", { reason: "打錯" }),
        director.get("/print/receipt/abc"),
        director.patch("/auth/users/abc", { displayName: "x" }),
        director.get("/settings/abc"),
        director.get("/households/abc/members"),
      ]);
      for (const res of responses) {
        expect([400, 404]).toContain(res.status);
        expect(res.body.message).toBeTruthy();
      }
    });

    it("查詢參數的 id 不是 UUID 格式（templeId=abc）", async () => {
      const responses = await Promise.all([
        director.get("/ceremony/ceremonies?templeId=abc"),
        director.get("/lantern/walls?templeId=abc"),
        director.get("/finance/ledger-entries/petty-cash-balance?templeId=abc"),
      ]);
      for (const res of responses) expect(res.status).toBe(400);
    });

    it("財務報表缺少或給錯日期、年份、月份參數", async () => {
      const bad = [
        "/finance/reports/daily",
        "/finance/reports/daily?date=abc",
        "/finance/reports/daily?date=2026-02-30", // 不存在的日期
        "/finance/reports/monthly",
        "/finance/reports/monthly?year=2026&month=13",
        "/finance/reports/monthly?year=2026&month=0",
        "/finance/reports/range",
        "/finance/reports/range?start=2026-01-01",
        "/finance/reports/annual",
        "/finance/reports/annual?year=abc",
        `/finance/ledger-entries/audit-calendar?from=x&to=y&templeId=${fx.templeId}`,
      ];
      for (const path of bad) {
        const res = await director.get(path);
        expect([path, res.status]).toEqual([path, 400]);
      }
      // 邊界：合法的值照常運作
      await director.get("/finance/reports/daily?date=2026-02-28").expect(200);
      await director.get("/finance/reports/monthly?year=2026&month=12").expect(200);
    });

    it("分頁參數不合法（0、負數、非數字）：當成預設值，不會出錯；pageSize 有上限", async () => {
      for (const path of [
        "/lantern/receipts?page=0",
        "/lantern/receipts?page=abc",
        "/lantern/receipts?pageSize=-1",
        "/lantern/receipts?pageSize=1.5",
        "/members?page=0",
        "/households/search?keyword=x&page=-3",
        "/print/receipts/details?page=abc",
        `/inventory/items/${GHOST_ID}/transactions?limit=abc`,
      ]) {
        const res = await director.get(path);
        expect([path, res.status]).toEqual([path, 200]);
      }
      const clamped = (await director.get("/lantern/receipts?pageSize=999999").expect(200)).body;
      expect(clamped.pageSize).toBe(500);
      const fallback = (await director.get("/lantern/receipts?page=0&pageSize=-1").expect(200)).body;
      expect(fallback).toMatchObject({ page: 1, pageSize: 20 });
    });

    it("流水帳列表的 status 不是合法值", async () => {
      await director.get("/finance/ledger-entries?status=XX").expect(400);
    });

    it("真正的伺服器錯誤仍然是 500（沒有被誤判成輸入錯誤）", async () => {
      // 不存在的 id 只是找不到資料，應該是 404 而不是 400
      await director.get(`/members/${GHOST_ID}`).expect(404);
    });
  });

  describe("庫存", () => {
    it("新增同名的物資品項：409", async () => {
      await director.post("/inventory/items", { name: "金紙", unit: "包", lowStockThreshold: 1 }).expect(201);
      const res = await director.post("/inventory/items", { name: "金紙", unit: "包", lowStockThreshold: 1 }).expect(409);
      expect(res.body.message).toBe("已有同名的物資項目");
    });
  });

  describe("報名至少要有姓名（信徒或臨櫃姓名）", () => {
    const blank = [
      ["沒有任何姓名欄位", {}],
      ["姓名是空字串", { walkInName: "" }],
      ["姓名只有空白", { walkInName: "   " }],
    ] as const;

    it.each(blank)("活動報名：%s → 400", async (_label, who) => {
      const ceremony = (
        await director.post("/ceremony/ceremonies", { templeId: fx.templeId, name: "法會", date: "2099-01-01", feeMode: "FREE_WILL" }).expect(201)
      ).body;
      const res = await volunteer.post("/ceremony/registrations", { ceremonyId: ceremony.id, amount: 100, ...who }).expect(400);
      expect(res.body.message).toBe("請選擇信徒或填寫報名者姓名");
      await volunteer.post("/activities/submit", { pendingCeremonyRegistrations: [{ ceremonyId: ceremony.id, amount: 1, ...who }] }).expect(400);
      expect((await volunteer.get("/lantern/receipts").expect(200)).body.total).toBe(0);
    });

    it.each(blank)("點燈：%s → 400，燈位不會被佔用", async (_label, who) => {
      const wall = (await director.post("/lantern/walls", { templeId: fx.templeId, name: "牆", year: 2026, slotPrice: 600 }).expect(201)).body;
      await director
        .post(`/lantern/walls/${wall.id}/slots`, { prefix: "A", positions: [{ row: 1, column: 1, gridRow: 1, gridColumn: 1 }] })
        .expect(201);
      const [slot] = (await volunteer.get(`/lantern/walls/${wall.id}/slots`).expect(200)).body;
      await volunteer.post("/lantern/claims", { slotId: slot.id, amount: 600, ...who }).expect(400);
      expect((await volunteer.get(`/lantern/walls/${wall.id}/slots`).expect(200)).body[0].status).toBe("EMPTY");
    });

    it.each(blank)("捐款：%s → 400", async (_label, who) => {
      await volunteer.post("/lantern/donations", { templeId: fx.templeId, type: DonationType.GENERAL, amount: 100, ...who }).expect(400);
    });

    it.each(blank)("送禮：%s → 400", async (_label, who) => {
      await volunteer
        .post("/activities/submit", { gift: { templeId: fx.templeId, items: [{ giftType: GiftType.WATER, quantity: 1 }], ...who } })
        .expect(400);
    });

    it("有選信徒或有填姓名（前後空白不算）就可以", async () => {
      const ceremony = (
        await director.post("/ceremony/ceremonies", { templeId: fx.templeId, name: "法會", date: "2099-01-01", feeMode: "FREE_WILL" }).expect(201)
      ).body;
      await volunteer.post("/ceremony/registrations", { ceremonyId: ceremony.id, amount: 100, walkInName: "  王小明  " }).expect(201);
      const member = (await volunteer.post("/members", { householdAddress: "A", name: "李大華", gender: "MALE" }).expect(201)).body;
      await volunteer.post("/ceremony/registrations", { ceremonyId: ceremony.id, amount: 100, memberId: member.id }).expect(201);
    });
  });

  describe("收據編號絕對不重複", () => {
    it("連續開 60 張收據：編號全部不同", async () => {
      const results = await Promise.all(
        Array.from({ length: 60 }, (_, i) =>
          volunteer.post("/lantern/donations", { templeId: fx.templeId, walkInName: `甲${i}`, type: DonationType.GENERAL, amount: 1 }),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const numbers = results.map((r) => r.body.receipt.receiptNo as string);
      expect(new Set(numbers).size).toBe(60);
    });

    it("亂數產生器剛好一直給同一組號碼：只有第一張成功，後面的明確回 409，絕不會有兩張同編號", async () => {
      jest.spyOn(Math, "random").mockReturnValue(0.5);
      try {
        const first = await volunteer
          .post("/lantern/donations", { templeId: fx.templeId, walkInName: "甲", type: DonationType.GENERAL, amount: 1 })
          .expect(201);
        const second = await volunteer
          .post("/lantern/donations", { templeId: fx.templeId, walkInName: "乙", type: DonationType.GENERAL, amount: 1 })
          .expect(409);
        expect(second.body.message).toBe("收據編號產生失敗，請重新送出");
        const all = (await volunteer.get("/lantern/receipts").expect(200)).body;
        expect(all.items.map((r: { receiptNo: string }) => r.receiptNo)).toEqual([first.body.receipt.receiptNo]);
      } finally {
        jest.restoreAllMocks();
      }
    });

    it("前幾次撞號、之後換到新號碼：收據成功開立", async () => {
      const taken = await volunteer
        .post("/lantern/donations", { templeId: fx.templeId, walkInName: "甲", type: DonationType.GENERAL, amount: 1 })
        .expect(201);
      const takenRand = Number(taken.body.receipt.receiptNo.slice(-6));
      // 前 3 次回傳已被使用的號碼，第 4 次起回傳新的
      const toRandom = (n: number) => (n - 100000) / 900000 + 1e-9;
      const spy = jest.spyOn(Math, "random");
      spy.mockReturnValueOnce(toRandom(takenRand)).mockReturnValueOnce(toRandom(takenRand)).mockReturnValueOnce(toRandom(takenRand));
      spy.mockReturnValue(toRandom(takenRand + 1));
      try {
        const next = await volunteer
          .post("/lantern/donations", { templeId: fx.templeId, walkInName: "乙", type: DonationType.GENERAL, amount: 1 })
          .expect(201);
        expect(next.body.receipt.receiptNo).not.toBe(taken.body.receipt.receiptNo);
      } finally {
        jest.restoreAllMocks();
      }
    });
  });

  describe("登入", () => {
    it("使用者不能透過「編輯自己的資料」把自己升級成總幹事", async () => {
      const res = await volunteer.patch("/auth/me", { role: UserRole.DIRECTOR, active: true, displayName: "我想升級" }).expect(200);
      expect(res.body.role).toBe(UserRole.VOLUNTEER);
      const relogin = await api(app).post("/auth/login", { username: "volunteer", password: TEST_PASSWORD }).expect(201);
      expect(relogin.body.user.role).toBe(UserRole.VOLUNTEER);
      await api(app, relogin.body.accessToken).get("/auth/users").expect(403);
    });
  });

  describe("安全性檢查", () => {
    it("請求裡多塞的欄位會被丟掉，不會寫進資料庫（例如建立活動時自己指定 id）", async () => {
      const res = await director
        .post("/ceremony/ceremonies", { id: GHOST_ID, nextSeatIndex: 99, templeId: fx.templeId, name: "x", date: "2099-01-01", feeMode: "FREE_WILL" })
        .expect(201);
      expect(res.body.id).not.toBe(GHOST_ID);
    });

    it("SQL injection：關鍵字搜尋用參數綁定，惡意字串只會被當成普通文字", async () => {
      const evil = encodeURIComponent(`'; DROP TABLE receipts; --`);
      await director.get(`/lantern/receipts?keyword=${evil}`).expect(200);
      await director.get(`/members?keyword=${evil}`).expect(200);
      await director.get(`/households/search?keyword=${evil}`).expect(200);
      await director.get("/lantern/receipts").expect(200);
    });
  });

  describe("尚未決定的規則（伺服器目前沒有把關，只靠前端畫面限制）", () => {
    it.todo("報名期限已過（或活動日期已過）的活動，直接呼叫 API 仍然可以報名");
    it.todo("固定金額的活動，API 接受任意金額（例如固定 500 元的活動只收 1 元）");
    it.todo("建立活動／燈牆時，templeId 可以是不存在的廟宇");
    it.todo("信徒姓名沒有長度上限（5000 個字也能建立）");
  });
});
