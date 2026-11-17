import { INestApplication } from "@nestjs/common";
import { DonationType, GiftType, UserRole } from "@tms/shared";
import { api, BaseFixture, createTestApp, resetDatabase, seedBaseFixture, TEST_PASSWORD } from "../support/app";

const GHOST_ID = "00000000-0000-4000-8000-000000000000";

/**
 * 黑箱測試先前發現的問題，修正後轉成正式的回歸測試；仍未決定的規則留在最後面用 it.todo 記錄。
 */
describe("先前發現問題的回歸測試與伺服器端把關", () => {
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
      await volunteer.post("/lantern/claims", { slotId: slot.id, lanternType: "光明燈", amount: 600, ...who }).expect(400);
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

    it.each([
      ["沒有填", undefined],
      ["空字串", ""],
      ["只有空白", "   "],
    ])("點燈內容%s → 400，燈位不會被佔用；編輯時也不能清成空白", async (_label, lanternType) => {
      const wall = (await director.post("/lantern/walls", { templeId: fx.templeId, name: "牆", year: 2026, slotPrice: 600 }).expect(201)).body;
      await director
        .post(`/lantern/walls/${wall.id}/slots`, { prefix: "A", positions: [{ row: 1, column: 1, gridRow: 1, gridColumn: 1 }] })
        .expect(201);
      const [slot] = (await volunteer.get(`/lantern/walls/${wall.id}/slots`).expect(200)).body;
      const res = await volunteer.post("/lantern/claims", { slotId: slot.id, walkInName: "甲", amount: 600, lanternType }).expect(400);
      expect(JSON.stringify(res.body.message)).toContain("點燈內容");
      await volunteer.post("/activities/submit", { pendingLanternClaims: [{ slotId: slot.id, walkInName: "甲", amount: 600, lanternType }] }).expect(400);
      expect((await volunteer.get(`/lantern/walls/${wall.id}/slots`).expect(200)).body[0].status).toBe("EMPTY");

      const ok = await volunteer.post("/lantern/claims", { slotId: slot.id, walkInName: "甲", amount: 600, lanternType: "光明燈、平安燈" }).expect(201);
      const claimId = ok.body.slot.claim.id;
      const blank = await volunteer.patch(`/lantern/claims/${claimId}`, { lanternType }).catch(() => undefined);
      if (lanternType !== undefined) expect(blank?.status).toBe(400);
      expect((await volunteer.get(`/lantern/walls/${wall.id}/slots`).expect(200)).body[0].claim.lanternType).toBe("光明燈、平安燈");
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

  describe("伺服器端把關（不能只靠前端畫面限制）", () => {
    const day = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const create = async (overrides: Record<string, unknown> = {}) =>
      (
        await director
          .post("/ceremony/ceremonies", { templeId: fx.templeId, name: "法會", date: day(10), feeMode: "FREE_WILL", ...overrides })
          .expect(201)
      ).body;
    const submit = (registration: Record<string, unknown>) =>
      volunteer.post("/activities/submit", { pendingCeremonyRegistrations: [registration] });

    describe("報名期限", () => {
      it("活動日期已過、沒設報名期限：所有報名方式都 400", async () => {
        const c = await create({ date: day(-1), tableCount: 1, seatsPerTable: 2 });
        const bus = await create({ date: day(-1), kind: "PILGRIMAGE", busCount: 1, roomTypes: [{ name: "雙人房", capacity: 2, fee: 0, roomCount: 5 }] });
        const m = (await volunteer.post("/members", { householdAddress: "A", name: "王小明", gender: "MALE" }).expect(201)).body;
        const base = { ceremonyId: c.id, amount: 0 };
        const attempts = [
          volunteer.post("/ceremony/registrations", { ...base, walkInName: "甲" }),
          submit({ ...base, walkInName: "甲", seatIndex: 1 }),
          submit({ ...base, householdId: m.householdId }),
          submit({ ...base, walkInName: "甲", tableNumber: 1 }),
          submit({ ceremonyId: bus.id, amount: 0, walkInName: "甲", roomType: "雙人房" }),
        ];
        for (const res of await Promise.all(attempts)) {
          expect(res.status).toBe(400);
          expect(res.body.message).toBe("此活動已過報名期限，無法報名");
        }
        expect((await volunteer.get("/lantern/receipts").expect(200)).body.total).toBe(0);
      });

      it("有設報名期限：以期限為準（期限已過即使活動還沒到也不行；期限當天可以）", async () => {
        const expired = await create({ date: day(10), registrationDeadline: day(-1) });
        await volunteer.post("/ceremony/registrations", { ceremonyId: expired.id, walkInName: "甲", amount: 1 }).expect(400);
        const lastDay = await create({ date: day(-5), registrationDeadline: day(0) });
        await volunteer.post("/ceremony/registrations", { ceremonyId: lastDay.id, walkInName: "甲", amount: 1 }).expect(201);
      });

      it("邊界：活動日期就是今天（沒設期限）還可以報名", async () => {
        const today = await create({ date: day(0) });
        await volunteer.post("/ceremony/registrations", { ceremonyId: today.id, walkInName: "甲", amount: 1 }).expect(201);
      });
    });

    describe("固定金額", () => {
      it("單人：金額必須剛好等於單價（少一元、多一元都 400）", async () => {
        const c = await create({ feeMode: "FIXED_AMOUNT", fixedAmount: 500 });
        const reg = (amount: number) => volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount });
        const wrong = await reg(499).expect(400);
        expect(wrong.body.message).toBe("此活動為固定金額，1 人應收 NT$ 500");
        await reg(501).expect(400);
        await reg(0).expect(400);
        await reg(500).expect(201);
      });

      it("整戶：單價 × 戶內人數", async () => {
        const c = await create({ feeMode: "FIXED_AMOUNT", fixedAmount: 300 });
        const a = (await volunteer.post("/members", { householdAddress: "陳家", name: "陳一", gender: "MALE" }).expect(201)).body;
        await volunteer.post("/members", { householdAddress: "陳家", name: "陳二", gender: "MALE" }).expect(201);
        await submit({ ceremonyId: c.id, householdId: a.householdId, amount: 300 }).expect(400);
        await submit({ ceremonyId: c.id, householdId: a.householdId, amount: 600 }).expect(201);
      });

      it("認領整桌：單價 × 每桌人數", async () => {
        const c = await create({ feeMode: "FIXED_AMOUNT", fixedAmount: 100, tableCount: 2, seatsPerTable: 3 });
        await submit({ ceremonyId: c.id, walkInName: "甲", tableNumber: 1, amount: 100 }).expect(400);
        await submit({ ceremonyId: c.id, walkInName: "甲", tableNumber: 1, amount: 300 }).expect(201);
      });

      it("進香：房型每人費用 × 人數；祭改：單價 × 1", async () => {
        const bus = await create({
          kind: "PILGRIMAGE",
          busCount: 1,
          roomTypes: [{ name: "雙人房", capacity: 2, fee: 3000, roomCount: 5 }],
        });
        await submit({ ceremonyId: bus.id, walkInName: "甲", roomType: "雙人房", amount: 1600 }).expect(400);
        await submit({ ceremonyId: bus.id, walkInName: "甲", roomType: "雙人房", amount: 3000 }).expect(201);
        const twoPeople = { ceremonyId: bus.id, walkInName: "乙", roomType: "雙人房", passengerMemberIds: ["", ""], passengerNames: ["", "丙"] };
        await submit({ ...twoPeople, amount: 3000 }).expect(400);
        await submit({ ...twoPeople, amount: 6000 }).expect(201);

        const jigai = await create({ kind: "JIGAI", feeMode: "FIXED_AMOUNT", fixedAmount: 300, morningCapacity: 5, afternoonCapacity: 5 });
        await submit({ ceremonyId: jigai.id, walkInName: "甲", session: "AM", amount: 1 }).expect(400);
        await submit({ ceremonyId: jigai.id, walkInName: "甲", session: "AM", amount: 300 }).expect(201);
      });

      it("小數單價也用「分」比對，不會有浮點誤差", async () => {
        const c = await create({ feeMode: "FIXED_AMOUNT", fixedAmount: 0.1 });
        const m = (await volunteer.post("/members", { householdAddress: "李家", name: "李一", gender: "MALE" }).expect(201)).body;
        for (const name of ["李二", "李三"]) await volunteer.post("/members", { householdAddress: "李家", name, gender: "MALE" }).expect(201);
        await submit({ ceremonyId: c.id, householdId: m.householdId, amount: 0.3 }).expect(201);
      });

      it("隨喜活動不限金額（包含 0）", async () => {
        const c = await create();
        await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount: 0 }).expect(201);
        await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "乙", amount: 12345 }).expect(201);
      });
    });

    describe("廟宇必須存在", () => {
      it("建立活動、燈牆時廟宇不存在：404", async () => {
        const res = await director
          .post("/ceremony/ceremonies", { templeId: GHOST_ID, name: "x", date: day(1), feeMode: "FREE_WILL" })
          .expect(404);
        expect(res.body.message).toBe("找不到此廟宇");
        await director.post("/lantern/walls", { templeId: GHOST_ID, name: "牆", year: 2026, slotPrice: 600 }).expect(404);
        expect((await volunteer.get("/ceremony/ceremonies").expect(200)).body).toEqual([]);
        expect((await volunteer.get("/lantern/walls").expect(200)).body).toEqual([]);
      });
    });

    describe("姓名長度上限 50 字", () => {
      const name = (n: number) => "名".repeat(n);

      it("信徒姓名：50 字可以、51 字 400（新增與編輯都一樣）", async () => {
        const m = (await volunteer.post("/members", { householdAddress: "A", name: name(50), gender: "MALE" }).expect(201)).body;
        await volunteer.post("/members", { householdAddress: "A", name: name(51), gender: "MALE" }).expect(400);
        await volunteer.patch(`/members/${m.id}`, { name: name(51) }).expect(400);
        await volunteer.patch(`/members/${m.id}`, { name: name(10) }).expect(200);
      });

      it("臨櫃姓名：活動報名、點燈認領、捐款、送禮、同行乘客都有上限", async () => {
        const c = await create({ kind: "PILGRIMAGE", busCount: 1, roomTypes: [{ name: "雙人房", capacity: 2, fee: 0, roomCount: 5 }] });
        await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: name(51), amount: 0 }).expect(400);
        await submit({
          ceremonyId: c.id,
          walkInName: "甲",
          roomType: "雙人房",
          amount: 0,
          passengerMemberIds: ["", ""],
          passengerNames: ["", name(51)],
        }).expect(400);
        await submit({ ceremonyId: c.id, walkInName: name(50), roomType: "雙人房", amount: 0 }).expect(201);
        await volunteer.post("/lantern/claims", { slotId: GHOST_ID, lanternType: "光明燈", walkInName: name(51), amount: 1 }).expect(400);
        await volunteer.post("/lantern/donations", { templeId: fx.templeId, walkInName: name(51), type: DonationType.GENERAL, amount: 1 }).expect(400);
        await volunteer
          .post("/activities/submit", { gift: { templeId: fx.templeId, walkInName: name(51), items: [{ giftType: GiftType.WATER, quantity: 1 }] } })
          .expect(400);
      });
    });
  });
});
