import { INestApplication } from "@nestjs/common";
import { CeremonyFeeMode, DonationType, GiftType, UserRole } from "@tms/shared";
import { api, BaseFixture, createMember, createTestApp, resetDatabase, seedBaseFixture } from "../support/app";

const GHOST_ID = "00000000-0000-4000-8000-000000000000";

/**
 * 黑箱測試：點燈牆、捐款、送禮、合併開立收據、收據作廢／刪除／列印。
 */
describe("點燈、捐款與收據（黑箱／HTTP API）", () => {
  let app: INestApplication;
  let fx: BaseFixture;
  let director: ReturnType<typeof api>;
  let finance: ReturnType<typeof api>;
  let volunteer: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    fx = await seedBaseFixture(app);
    director = api(app, fx.tokens[UserRole.DIRECTOR]);
    finance = api(app, fx.tokens[UserRole.FINANCE]);
    volunteer = api(app, fx.tokens[UserRole.VOLUNTEER]);
  });
  afterAll(async () => {
    await app.close();
  });

  /** 建一面燈牆，並在同一排產生 count 個燈位（代碼 A-01、A-02…），回傳燈牆與燈位 */
  const createWallWithSlots = async (count = 3, name = "右牆") => {
    const wall = (
      await director
        .post("/lantern/walls", { templeId: fx.templeId, name, year: new Date().getFullYear(), slotPrice: 600 })
        .expect(201)
    ).body;
    await director
      .post(`/lantern/walls/${wall.id}/slots`, {
        prefix: "A",
        positions: Array.from({ length: count }, (_, i) => ({ row: 1, column: i + 1, gridRow: 1, gridColumn: i + 1 })),
      })
      .expect(201);
    const slots = (await volunteer.get(`/lantern/walls/${wall.id}/slots`).expect(200)).body as {
      id: string;
      code: string;
      status: string;
      claim?: { id: string; memberName: string };
    }[];
    return { wall, slots };
  };

  const slotsOf = async (wallId: string) =>
    (await volunteer.get(`/lantern/walls/${wallId}/slots`).expect(200)).body as {
      id: string;
      code: string;
      status: string;
      claim?: { id: string; memberName: string; lanternType: string | null };
    }[];

  // ───────────────────────────── 燈牆與燈位 ─────────────────────────────
  describe("燈牆與燈位", () => {
    it("建立燈牆、產生燈位：單排用 A-01 命名，燈位一開始都是空的", async () => {
      const { wall, slots } = await createWallWithSlots(3);
      expect(wall).toMatchObject({ name: "右牆", slotPrice: 600, slotCount: 0, claimedCount: 0, isTaisuiWall: false });
      expect(slots.map((s) => s.code)).toEqual(["A-01", "A-02", "A-03"]);
      expect(slots.every((s) => s.status === "EMPTY")).toBe(true);
    });

    it("跨多排時用「前綴＋排號-格號」命名（B1-01、B2-01）", async () => {
      const { wall } = await createWallWithSlots(1);
      await director
        .post(`/lantern/walls/${wall.id}/slots`, {
          prefix: "B",
          positions: [
            { row: 1, column: 1, gridRow: 2, gridColumn: 1 },
            { row: 2, column: 1, gridRow: 3, gridColumn: 1 },
          ],
        })
        .expect(201);
      expect((await slotsOf(wall.id)).map((s) => s.code)).toEqual(["A-01", "B1-01", "B2-01"]);
    });

    it("燈位代碼重複：409", async () => {
      const { wall } = await createWallWithSlots(2);
      const res = await director
        .post(`/lantern/walls/${wall.id}/slots`, { prefix: "A", positions: [{ row: 1, column: 1, gridRow: 5, gridColumn: 5 }] })
        .expect(409);
      expect(res.body.message).toContain("燈位代碼重複");
    });

    it.each([
      ["年份早於 2000（邊界 1999）", { year: 1999 }],
      ["單價為 0（必須大於 0）", { slotPrice: 0 }],
      ["缺少名稱", { name: undefined }],
    ])("建立燈牆輸入驗證：%s → 400", async (_label, overrides) => {
      await director
        .post("/lantern/walls", { templeId: fx.templeId, name: "牆", year: 2026, slotPrice: 600, ...overrides })
        .expect(400);
    });

    it("邊界值：年份 2000 可以建立；沒有選任何燈位位置不能產生燈位", async () => {
      const wall = (
        await director.post("/lantern/walls", { templeId: fx.templeId, name: "牆", year: 2000, slotPrice: 1 }).expect(201)
      ).body;
      await director.post(`/lantern/walls/${wall.id}/slots`, { prefix: "A", positions: [] }).expect(400);
    });

    it("志工不能建立燈牆或產生燈位：403", async () => {
      const { wall } = await createWallWithSlots(1);
      await volunteer.post("/lantern/walls", { templeId: fx.templeId, name: "牆", year: 2026, slotPrice: 1 }).expect(403);
      await volunteer
        .post(`/lantern/walls/${wall.id}/slots`, { prefix: "Z", positions: [{ row: 1, column: 1, gridRow: 9, gridColumn: 9 }] })
        .expect(403);
    });

    it("燈牆列表統計燈位數、已點燈數與金額", async () => {
      const { wall, slots } = await createWallWithSlots(3);
      await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "甲", amount: 600 }).expect(201);
      await volunteer.post("/lantern/claims", { slotId: slots[1].id, lanternType: "平安燈", walkInName: "乙", amount: 1000 }).expect(201);
      const [listed] = (await volunteer.get(`/lantern/walls?templeId=${fx.templeId}`).expect(200)).body;
      expect(listed).toMatchObject({ id: wall.id, slotCount: 3, claimedCount: 2, totalAmount: 1600 });
    });

    it("刪除燈牆：已有人點燈先 409，force 才刪", async () => {
      const { wall, slots } = await createWallWithSlots(2);
      await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "甲", amount: 600 }).expect(201);
      const blocked = await director.delete(`/lantern/walls/${wall.id}`).expect(409);
      expect(blocked.body.claimedCount).toBe(1);
      await director.delete(`/lantern/walls/${wall.id}?force=true`).expect(200);
      expect((await volunteer.get("/lantern/walls").expect(200)).body).toEqual([]);
    });

    it("改燈牆名稱；不存在的燈牆 404", async () => {
      const { wall } = await createWallWithSlots(1);
      const res = await director.patch(`/lantern/walls/${wall.id}`, { name: "平安燈牆", isTaisuiWall: true }).expect(200);
      expect(res.body).toMatchObject({ name: "平安燈牆", isTaisuiWall: true });
      await director.patch(`/lantern/walls/${GHOST_ID}`, { name: "x" }).expect(404);
      await volunteer.get(`/lantern/walls/${GHOST_ID}/slots`).expect(404);
    });
  });

  // ───────────────────────────── 點燈 ─────────────────────────────
  // ───────────────────────────── 燈種計價 ─────────────────────────────
  describe("燈種計價（不再依燈牆計價）", () => {
    const claim = (slotId: string, lanternType: string | undefined, amount: number, client = volunteer) =>
      client.post("/lantern/claims", { slotId, lanternType, walkInName: "甲", amount });
    const DEFAULTS: [string, number][] = [
      ["平安燈(大)", 5000],
      ["平安燈(中)", 3000],
      ["平安燈", 1000],
      ["發財燈", 600],
      ["光明燈", 600],
      ["太歲燈", 500],
    ];

    it("沒設定過時使用預設的 6 種燈種與價格；報名櫃檯人員也讀得到", async () => {
      const read = async (client = volunteer) => (await client.get(`/lantern/types?templeId=${fx.templeId}`).expect(200)).body;
      expect((await read()).map((t: { name: string; price: number }) => [t.name, t.price])).toEqual(DEFAULTS);
      expect(await read(api(app, fx.tokens[UserRole.REGISTRAR]))).toHaveLength(6);
      await volunteer.get(`/lantern/types?templeId=${GHOST_ID}`).expect(404);
    });

    it.each(DEFAULTS)("%s 一盞 %d 元：金額剛好才收，多一元少一元都 400，燈位不會被佔用", async (type, price) => {
      const { wall, slots } = await createWallWithSlots(1);
      for (const wrong of [price - 1, price + 1, 0]) {
        const res = await claim(slots[0].id, type, wrong).expect(400);
        expect(res.body.message).toBe(`${type}每盞 NT$ ${price}，金額不正確`);
      }
      expect((await slotsOf(wall.id))[0].status).toBe("EMPTY");
      await claim(slots[0].id, type, price).expect(201);
    });

    it("燈種必須是清單裡的單一一種：不存在、複選（舊的「、」格式）都 400", async () => {
      const { slots } = await createWallWithSlots(1);
      expect((await claim(slots[0].id, "豪華燈", 600).expect(400)).body.message).toBe("找不到燈種「豪華燈」，請重新選擇");
      await claim(slots[0].id, "光明燈、發財燈", 1200).expect(400);
    });

    it("燈牆的價格不再影響收費：同一面燈牆可以點不同價格的燈", async () => {
      const { slots } = await createWallWithSlots(3); // 燈牆單價 600
      await claim(slots[0].id, "平安燈(大)", 5000).expect(201);
      await claim(slots[1].id, "太歲燈", 500).expect(201);
      await claim(slots[2].id, "光明燈", 600).expect(201);
      const receipts = (await volunteer.get("/lantern/receipts").expect(200)).body;
      expect(receipts.items.map((r: { amount: number }) => r.amount).sort((a: number, b: number) => a - b)).toEqual([500, 600, 5000]);
    });

    it("燈牆可以不填單價（不再使用）", async () => {
      const wall = (await director.post("/lantern/walls", { templeId: fx.templeId, name: "新牆", year: 2026 }).expect(201)).body;
      expect(wall.slotPrice).toBe(0);
    });

    it("一次選多個燈位、每個燈位各點一種燈，合併成一張收據，金額是各燈種價格相加", async () => {
      const { slots } = await createWallWithSlots(3);
      const res = await volunteer
        .post("/activities/submit", {
          pendingLanternClaims: [
            { slotId: slots[0].id, lanternType: "平安燈(大)", walkInName: "王小明", amount: 5000 },
            { slotId: slots[1].id, lanternType: "光明燈", walkInName: "王小明", amount: 600 },
            { slotId: slots[2].id, lanternType: "太歲燈", walkInName: "王小明", amount: 500 },
          ],
        })
        .expect(201);
      expect(res.body.receipt.amount).toBe(6100);
      expect(res.body.receipt.items.map((i: { description: string; amount: number; note: string }) => [i.description, i.amount, i.note])).toEqual([
        ["平安燈(大)", 5000, "燈位：A-01"],
        ["光明燈", 600, "燈位：A-02"],
        ["太歲燈", 500, "燈位：A-03"],
      ]);
    });

    it("其中一盞金額不對：整張都不成立，前面已卡位的燈位全部放掉", async () => {
      const { wall, slots } = await createWallWithSlots(2);
      await volunteer
        .post("/activities/submit", {
          pendingLanternClaims: [
            { slotId: slots[0].id, lanternType: "光明燈", walkInName: "甲", amount: 600 },
            { slotId: slots[1].id, lanternType: "平安燈", walkInName: "甲", amount: 600 },
          ],
        })
        .expect(400);
      expect((await slotsOf(wall.id)).map((s) => s.status)).toEqual(["EMPTY", "EMPTY"]);
      expect((await volunteer.get("/lantern/receipts").expect(200)).body.total).toBe(0);
    });

    it("整戶點燈：同一種燈，金額 = 燈種價格 × 戶內人數，每筆認領都記上燈種", async () => {
      const { wall, slots } = await createWallWithSlots(2);
      const a = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "陳一", "陳家");
      await createMember(app, fx.tokens[UserRole.VOLUNTEER], "陳二", "陳家");
      const base = { wallId: wall.id, householdId: a.householdId, slotIds: [slots[0].id, slots[1].id] };
      const submit = (body: Record<string, unknown>) =>
        volunteer.post("/activities/submit", { pendingHouseholdLanternClaims: [{ ...base, ...body }] });

      expect((await submit({ lanternType: "平安燈", amount: 1000 }).expect(400)).body.message).toBe("平安燈每盞 NT$ 1000，2 盞應收 NT$ 2000");
      await submit({ lanternType: "豪華燈", amount: 2000 }).expect(400);
      await submit({ amount: 2000 }).expect(400); // 沒選燈種
      const ok = await submit({ lanternType: "平安燈", amount: 2000 }).expect(201);
      expect(ok.body.receipt.amount).toBe(2000);
      expect((await slotsOf(wall.id)).map((s) => s.claim?.lanternType)).toEqual(["平安燈", "平安燈"]);
    });

    describe("總幹事在系統設定修改燈種與價格", () => {
      const putTypes = (lanternTypes: unknown, client = director) => client.put(`/settings/${fx.templeId}`, { lanternTypes });
      const types = [
        { name: "平安燈(大)", price: 6000 },
        { name: "發財燈", price: 700 },
        { name: "太歲燈", price: 500 },
        { name: "文昌燈", price: 800 },
      ];

      it("改了之後新的價格和新增的燈種立刻生效；舊價格不再接受；設定頁讀得到", async () => {
        const saved = (await putTypes(types).expect(200)).body;
        expect(saved.lanternTypes).toEqual(types);
        expect((await director.get(`/settings/${fx.templeId}`).expect(200)).body.lanternTypes).toEqual(types);
        expect((await volunteer.get(`/lantern/types?templeId=${fx.templeId}`).expect(200)).body).toEqual(types);

        const { slots } = await createWallWithSlots(3);
        await claim(slots[0].id, "平安燈(大)", 5000).expect(400); // 舊價格
        await claim(slots[0].id, "平安燈(大)", 6000).expect(201);
        await claim(slots[1].id, "文昌燈", 800).expect(201); // 新增的燈種
        await claim(slots[2].id, "光明燈", 600).expect(400); // 已經被拿掉的燈種
      });

      it("不是總幹事不能改；其他設定欄位沒送時燈種不變", async () => {
        for (const role of [UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.REGISTRAR]) {
          await putTypes(types, api(app, fx.tokens[role])).expect(403);
        }
        await director.put(`/settings/${fx.templeId}`, { templeName: "新名稱" }).expect(200);
        expect((await volunteer.get(`/lantern/types?templeId=${fx.templeId}`).expect(200)).body).toHaveLength(6);
      });

      it.each([
        ["空清單", [], "請至少設定一種燈種"],
        ["名稱空白", [{ name: "  ", price: 1 }, { name: "太歲燈", price: 500 }], "燈種名稱不可空白"],
        ["名稱重複", [{ name: "太歲燈", price: 1 }, { name: " 太歲燈 ", price: 2 }], "燈種名稱不可重複"],
        ["名稱含「、」", [{ name: "甲、乙", price: 1 }, { name: "太歲燈", price: 500 }], "燈種名稱不可包含「、」"],
        ["沒有保留太歲燈", [{ name: "光明燈", price: 600 }], "燈種一定要保留「太歲燈」（太歲燈牆固定點這一種）"],
      ])("%s → 400", async (_label, body, message) => {
        expect((await putTypes(body).expect(400)).body.message).toBe(message);
      });

      it.each([
        ["價格為負", [{ name: "太歲燈", price: -1 }]],
        ["價格不是數字", [{ name: "太歲燈", price: "很貴" }]],
        ["名稱超過 20 字", [{ name: "太歲燈", price: 1 }, { name: "燈".repeat(21), price: 1 }]],
        ["不是陣列", "太歲燈"],
      ])("%s → 400（格式驗證）", async (_label, body) => {
        await putTypes(body).expect(400);
      });

      it("價格可以是 0 或小數（以分計算，不會因浮點誤差失敗）", async () => {
        await putTypes([{ name: "太歲燈", price: 0.1 }, { name: "結緣燈", price: 0 }]).expect(200);
        const { slots } = await createWallWithSlots(2);
        await claim(slots[0].id, "太歲燈", 0.1).expect(201);
        await claim(slots[1].id, "結緣燈", 0).expect(201);
      });
    });

    it("修改已點燈的燈種：只能換成價格相同的燈種（金額已開在收據上）", async () => {
      const { slots } = await createWallWithSlots(1);
      const claimed = (await claim(slots[0].id, "光明燈", 600).expect(201)).body.slot.claim;
      const edit = (lanternType: string) => volunteer.patch(`/lantern/claims/${claimed.id}`, { lanternType });
      expect((await edit("平安燈").expect(400)).body.message).toBe("平安燈每盞 NT$ 1000，與已收的 NT$ 600 不同，請作廢收據後重新點燈");
      expect((await edit("豪華燈").expect(400)).body.message).toBe("找不到燈種「豪華燈」，請重新選擇");
      expect((await edit("發財燈").expect(200)).body.claim.lanternType).toBe("發財燈");
      await edit("發財燈").expect(200); // 沒有變更
    });
  });

  describe("點燈認領", () => {
    it("認領燈位：燈位變成已認領，同時開立收據", async () => {
      const { wall, slots } = await createWallWithSlots(2);
      const member = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "龔忠欣");
      const res = await volunteer
        .post("/lantern/claims", { slotId: slots[0].id, memberId: member.id, amount: 600, lanternType: "光明燈" })
        .expect(201);
      expect(res.body.slot).toMatchObject({ code: "A-01", status: "CLAIMED" });
      expect(res.body.slot.claim).toMatchObject({ memberName: "龔忠欣", amount: 600, lanternType: "光明燈" });
      expect(res.body.receipt).toMatchObject({ amount: 600, status: "ISSUED", sourceType: "LANTERN_CLAIM" });

      const after = await slotsOf(wall.id);
      expect(after.map((s) => s.status)).toEqual(["CLAIMED", "EMPTY"]);
    });

    it("同一個燈位被第二個櫃台認領：409", async () => {
      const { slots } = await createWallWithSlots(1);
      await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "甲", amount: 600 }).expect(201);
      const res = await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "乙", amount: 600 }).expect(409);
      expect(res.body.message).toContain("此燈位已被其他櫃台認領");
    });

    it("兩個櫃台同時搶同一個燈位：只有一個成功", async () => {
      const { slots } = await createWallWithSlots(1);
      const [a, b] = await Promise.all([
        volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "A", amount: 600 }),
        finance.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "B", amount: 600 }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
    });

    it("燈位或信徒不存在：404；金額為負：400", async () => {
      const { slots } = await createWallWithSlots(1);
      await volunteer.post("/lantern/claims", { slotId: GHOST_ID, lanternType: "光明燈", walkInName: "甲", amount: 1 }).expect(404);
      await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", memberId: GHOST_ID, amount: 1 }).expect(404);
      await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "甲", amount: -1 }).expect(400);
      await volunteer.post("/lantern/claims", { slotId: "abc", lanternType: "光明燈", walkInName: "甲", amount: 1 }).expect(400);
    });

    it("可以修正已認領燈位的姓名與點燈內容", async () => {
      const { wall, slots } = await createWallWithSlots(1);
      const claimed = await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "打錯字", amount: 600 }).expect(201);
      const res = await volunteer
        .patch(`/lantern/claims/${claimed.body.slot.claim.id}`, { walkInName: "王小明", lanternType: "發財燈" })
        .expect(200);
      expect(res.body.claim).toMatchObject({ memberName: "王小明", lanternType: "發財燈" });
      expect((await slotsOf(wall.id))[0].claim).toMatchObject({ memberName: "王小明" });
      await volunteer.patch(`/lantern/claims/${GHOST_ID}`, { walkInName: "x" }).expect(404);
    });

    it("收據與列印資料顯示「燈位：代碼」", async () => {
      const { slots } = await createWallWithSlots(1, "右牆");
      const claimed = await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "龔忠欣", amount: 600 }).expect(201);
      const details = (await volunteer.get("/print/receipts/details").expect(200)).body;
      expect(details.items[0]).toMatchObject({ payerName: "龔忠欣", description: "光明燈", amount: 600 });

      const label = await volunteer.get(`/print/lantern-label/${claimed.body.slot.claim.id}`).expect(200);
      expect(label.text).toContain("右牆");
      expect(label.text).toContain("A-01");
      expect(label.text).toContain("龔忠欣");
    });
  });

  // ───────────────────────────── 活動報名頁：合併送出 ─────────────────────────────
  describe("合併送出（一張收據包含多個項目）", () => {
    it("單人點燈：備註是「燈位：代碼」，不加姓名", async () => {
      const { slots } = await createWallWithSlots(1, "右牆");
      const res = await volunteer
        .post("/activities/submit", { pendingLanternClaims: [{ slotId: slots[0].id, lanternType: "光明燈", walkInName: "龔忠欣", amount: 600 }] })
        .expect(201);
      expect(res.body.receipt).toMatchObject({ amount: 600, payerName: "龔忠欣", sourceType: "COMBINED" });
      expect(res.body.receipt.items[0]).toMatchObject({ description: "光明燈", note: "燈位：A-01" });
    });

    it("同一個人點兩盞燈：仍然不加姓名", async () => {
      const { slots } = await createWallWithSlots(2, "右牆");
      const res = await volunteer
        .post("/activities/submit", {
          pendingLanternClaims: [
            { slotId: slots[0].id, lanternType: "光明燈", walkInName: "龔忠欣", amount: 600 },
            { slotId: slots[1].id, lanternType: "光明燈", walkInName: "龔忠欣", amount: 600 },
          ],
        })
        .expect(201);
      expect(res.body.receipt.items.map((i: { note: string }) => i.note)).toEqual(["燈位：A-01", "燈位：A-02"]);
    });

    it("多人點燈：備註前面加上姓名「人，燈位：代碼」", async () => {
      const { slots } = await createWallWithSlots(2, "右牆");
      const res = await volunteer
        .post("/activities/submit", {
          pendingLanternClaims: [
            { slotId: slots[0].id, lanternType: "光明燈", walkInName: "王小明", amount: 600 },
            { slotId: slots[1].id, lanternType: "光明燈", walkInName: "李大華", amount: 600 },
          ],
        })
        .expect(201);
      expect(res.body.receipt.amount).toBe(1200);
      expect(res.body.receipt.items.map((i: { note: string }) => i.note)).toEqual([
        "王小明，燈位：A-01",
        "李大華，燈位：A-02",
      ]);
    });

    it("整戶點燈：每人一盞、金額均分，備註列出燈位；選位數與人數不符 400", async () => {
      const { wall, slots } = await createWallWithSlots(3);
      const token = fx.tokens[UserRole.VOLUNTEER];
      const a = await createMember(app, token, "陳一", "陳家");
      await createMember(app, token, "陳二", "陳家");
      const base = { wallId: wall.id, householdId: a.householdId, lanternType: "光明燈", amount: 1200 };

      await volunteer.post("/activities/submit", { pendingHouseholdLanternClaims: [{ ...base, slotIds: [slots[0].id] }] }).expect(400);

      const res = await volunteer
        .post("/activities/submit", { pendingHouseholdLanternClaims: [{ ...base, slotIds: [slots[0].id, slots[1].id] }] })
        .expect(201);
      expect(res.body.receipt).toMatchObject({ amount: 1200, payerName: "陳一、陳二" });
      expect(res.body.receipt.items[0]).toMatchObject({ description: "點燈*2人", note: "燈位｜A-01、A-02" });
      expect((await slotsOf(wall.id)).map((s) => s.status)).toEqual(["CLAIMED", "CLAIMED", "EMPTY"]);
    });

    it("點燈 + 捐款 + 活動報名 + 送禮合併成一張收據，金額加總", async () => {
      const { slots } = await createWallWithSlots(1);
      const ceremony = (
        await director
          .post("/ceremony/ceremonies", { templeId: fx.templeId, name: "法會", date: "2099-01-01", feeMode: CeremonyFeeMode.FREE_WILL })
          .expect(201)
      ).body;
      const member = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明");

      const res = await volunteer
        .post("/activities/submit", {
          pendingLanternClaims: [{ slotId: slots[0].id, lanternType: "光明燈", memberId: member.id, amount: 600 }],
          pendingCeremonyRegistrations: [{ ceremonyId: ceremony.id, memberId: member.id, amount: 1000 }],
          donation: { templeId: fx.templeId, memberId: member.id, type: DonationType.GENERAL, amount: 500 },
          gift: { templeId: fx.templeId, memberId: member.id, items: [{ giftType: GiftType.FLOWERS, quantity: 2 }] },
        })
        .expect(201);

      expect(res.body.receipt).toMatchObject({ amount: 2100, payerName: "王小明", sourceType: "COMBINED" });
      expect(res.body.receipt.items.map((i: { description: string; amount: number }) => [i.description, i.amount])).toEqual([
        ["光明燈", 600],
        ["法會", 1000],
        ["一般捐款", 500],
        ["送禮", 0],
      ]);
      expect(res.body.receipt.items[3].note).toBe("品項：鮮花x2");
      expect(res.body.donation).toMatchObject({ amount: 500, type: DonationType.GENERAL });
      expect(res.body.gifts).toHaveLength(1);
    });

    describe("一次開立多筆捐款與送禮；送禮指定活動", () => {
      const createCeremony = async (name = "進香") =>
        (
          await director
            .post("/ceremony/ceremonies", { templeId: fx.templeId, name, date: "2099-01-01", feeMode: CeremonyFeeMode.FREE_WILL })
            .expect(201)
        ).body;
      const ceremonyReport = async (id: string) => (await volunteer.get(`/ceremony/ceremonies/${id}/report`).expect(200)).body;

      it("多筆捐款與多筆送禮合併成一張收據，每一筆各是一個項目；指定活動的禮列在該活動報表", async () => {
        const ceremony = await createCeremony();
        const other = await createCeremony("餐會");
        const member = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明");

        const res = await volunteer
          .post("/activities/submit", {
            donations: [
              { templeId: fx.templeId, memberId: member.id, type: DonationType.GENERAL, amount: 500 },
              { templeId: fx.templeId, walkInName: "林老闆", type: DonationType.GENERAL, amount: 300, ceremonyId: ceremony.id },
            ],
            gifts: [
              { templeId: fx.templeId, walkInName: "陳太太", items: [{ giftType: GiftType.FLOWERS, quantity: 2 }], ceremonyId: ceremony.id },
              { templeId: fx.templeId, memberId: member.id, items: [{ giftType: GiftType.WATER, quantity: 3 }, { giftType: GiftType.BEER, quantity: 1 }] },
              { templeId: fx.templeId, walkInName: "張先生", items: [{ giftType: GiftType.DRINKS, quantity: 5 }], ceremonyId: other.id },
            ],
          })
          .expect(201);

        expect(res.body.receipt).toMatchObject({ amount: 800, payerName: "王小明" });
        expect(res.body.receipt.items.map((i: { description: string; amount: number; note?: string }) => [i.description, i.amount, i.note ?? null])).toEqual([
          ["一般捐款", 500, null],
          ["進香 捐款", 300, null],
          ["送禮", 0, "品項：鮮花x2"],
          ["送禮", 0, "品項：水x3、啤酒x1"],
          ["送禮", 0, "品項：飲料x5"],
        ]);
        expect(res.body.donation).toMatchObject({ amount: 500 });
        expect(res.body.donations).toHaveLength(2);
        expect(res.body.gifts.map((g: { giftType: string; ceremonyId: string | null }) => [g.giftType, g.ceremonyId])).toEqual([
          [GiftType.FLOWERS, ceremony.id],
          [GiftType.WATER, null],
          [GiftType.BEER, null],
          [GiftType.DRINKS, other.id],
        ]);

        // 活動報表只列指定給這個活動的禮與捐款
        const report = await ceremonyReport(ceremony.id);
        expect(report.gifts).toEqual([
          expect.objectContaining({ giverName: "陳太太", giftType: GiftType.FLOWERS, quantity: 2 }),
        ]);
        expect(report.donationTotal).toBe(300);
        expect((await ceremonyReport(other.id)).gifts.map((g: { giverName: string }) => g.giverName)).toEqual(["張先生"]);
      });

      it("單筆舊欄位（donation／gift）與多筆欄位可以並用，單筆排在前面", async () => {
        const res = await volunteer
          .post("/activities/submit", {
            donation: { templeId: fx.templeId, walkInName: "甲", type: DonationType.GENERAL, amount: 100 },
            donations: [{ templeId: fx.templeId, walkInName: "乙", type: DonationType.GENERAL, amount: 200 }],
            gift: { templeId: fx.templeId, walkInName: "甲", items: [{ giftType: GiftType.WATER, quantity: 1 }] },
            gifts: [{ templeId: fx.templeId, walkInName: "乙", items: [{ giftType: GiftType.BEER, quantity: 2 }] }],
          })
          .expect(201);
        expect(res.body.receipt.amount).toBe(300);
        expect(res.body.receipt.items.map((i: { amount: number; note?: string }) => [i.amount, i.note ?? null])).toEqual([
          [100, null],
          [200, null],
          [0, "品項：水x1"],
          [0, "品項：啤酒x2"],
        ]);
      });

      it("送禮指定的活動不存在：404，這次已建立的捐款、送禮全部取消，不開收據", async () => {
        const ceremony = await createCeremony();
        const member = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明");

        const res = await volunteer
          .post("/activities/submit", {
            donations: [{ templeId: fx.templeId, memberId: member.id, type: DonationType.GENERAL, amount: 500 }],
            gifts: [
              { templeId: fx.templeId, walkInName: "陳太太", items: [{ giftType: GiftType.FLOWERS, quantity: 1 }], ceremonyId: ceremony.id },
              { templeId: fx.templeId, walkInName: "陳太太", items: [{ giftType: GiftType.WATER, quantity: 1 }], ceremonyId: GHOST_ID },
            ],
          })
          .expect(404);
        expect(res.body.message).toBe("找不到活動");

        expect((await volunteer.get("/lantern/receipts").expect(200)).body.total).toBe(0);
        expect((await volunteer.get(`/lantern/members/${member.id}/history`).expect(200)).body).toEqual([]);
        expect((await ceremonyReport(ceremony.id)).gifts).toEqual([]);
      });

      it("送禮的活動 id 格式錯誤、多筆裡任一筆數量 0：400", async () => {
        const gift = (overrides: Record<string, unknown>) => ({
          templeId: fx.templeId,
          walkInName: "甲",
          items: [{ giftType: GiftType.WATER, quantity: 1 }],
          ...overrides,
        });
        await volunteer.post("/activities/submit", { gifts: [gift({ ceremonyId: "not-a-uuid" })] }).expect(400);
        await volunteer
          .post("/activities/submit", { gifts: [gift({}), gift({ items: [{ giftType: GiftType.WATER, quantity: 0 }] })] })
          .expect(400);
        await volunteer
          .post("/activities/submit", { donations: [{ templeId: fx.templeId, walkInName: "甲", type: DonationType.GENERAL, amount: -1 }] })
          .expect(400);
      });

      it("作廢收據後，那份禮就不再列在活動的收禮資訊", async () => {
        const ceremony = await createCeremony();
        const res = await volunteer
          .post("/activities/submit", {
            gifts: [{ templeId: fx.templeId, walkInName: "陳太太", items: [{ giftType: GiftType.FLOWERS, quantity: 1 }], ceremonyId: ceremony.id }],
          })
          .expect(201);
        expect((await ceremonyReport(ceremony.id)).gifts).toHaveLength(1);
        await finance.post(`/lantern/receipts/${res.body.receipt.id}/void`, { reason: "登記錯誤" }).expect(201);
        expect((await ceremonyReport(ceremony.id)).gifts).toEqual([]);
      });
    });

    it("完全沒有項目：400", async () => {
      const res = await volunteer.post("/activities/submit", {}).expect(400);
      expect(res.body.message).toBe("尚未填寫任何活動項目");
    });

    it("其中一項失敗：前面已經卡到的燈位會放掉，也不會開出收據", async () => {
      const { wall, slots } = await createWallWithSlots(2);
      await volunteer.post("/lantern/claims", { slotId: slots[1].id, lanternType: "光明燈", walkInName: "先來的", amount: 600 }).expect(201);

      await volunteer
        .post("/activities/submit", {
          pendingLanternClaims: [
            { slotId: slots[0].id, lanternType: "光明燈", walkInName: "後到的", amount: 600 },
            { slotId: slots[1].id, lanternType: "光明燈", walkInName: "後到的", amount: 600 }, // 已被認領
          ],
        })
        .expect(409);

      const after = await slotsOf(wall.id);
      expect(after[0].status).toBe("EMPTY");
      expect(after[1].claim?.memberName).toBe("先來的");
      const receipts = (await volunteer.get("/lantern/receipts").expect(200)).body;
      expect(receipts.total).toBe(1);
    });

    it("巢狀項目也會做輸入驗證（送禮數量 0 → 400）", async () => {
      await volunteer
        .post("/activities/submit", { gift: { templeId: fx.templeId, walkInName: "甲", items: [{ giftType: GiftType.WATER, quantity: 0 }] } })
        .expect(400);
      await volunteer
        .post("/activities/submit", { gift: { templeId: fx.templeId, walkInName: "甲", items: [] } })
        .expect(400);
    });

    it("資料建檔人員（DATA_ENTRY）不能辦理報名：403", async () => {
      await api(app, fx.tokens[UserRole.DATA_ENTRY]).post("/activities/submit", {}).expect(403);
    });
  });

  // ───────────────────────────── 捐款 ─────────────────────────────
  describe("捐款", () => {
    const donate = (body: Record<string, unknown>, client = volunteer) =>
      client.post("/lantern/donations", { templeId: fx.templeId, walkInName: "善心人士", type: DonationType.GENERAL, amount: 1000, ...body });

    it("建立捐款並開立收據", async () => {
      const res = await donate({}).expect(201);
      expect(res.body.donation).toMatchObject({ amount: 1000, type: DonationType.GENERAL, walkInName: "善心人士" });
      expect(res.body.receipt).toMatchObject({ amount: 1000, sourceType: "DONATION", status: "ISSUED" });
    });

    it("自訂捐款項目與數量只有總幹事可以填", async () => {
      await donate({ customItem: "金牌", quantity: 2 }).expect(403);
      await donate({ customItem: "金牌", quantity: 2 }, director).expect(201);
      const details = (await volunteer.get("/print/receipts/details").expect(200)).body;
      expect(details.items[0]).toMatchObject({ description: "一般捐款", payerName: "善心人士" });
    });

    it("指定捐給某個活動：算進該活動的捐款，項目名稱是「活動名稱 捐款」", async () => {
      const ceremony = (
        await director
          .post("/ceremony/ceremonies", { templeId: fx.templeId, name: "建醮", date: "2099-01-01", feeMode: CeremonyFeeMode.FREE_WILL })
          .expect(201)
      ).body;
      await donate({ ceremonyId: ceremony.id, amount: 5000 }).expect(201);
      await donate({ ceremonyId: GHOST_ID }).expect(404);

      const report = (await volunteer.get(`/ceremony/ceremonies/${ceremony.id}/report`).expect(200)).body;
      expect(report.donationTotal).toBe(5000);
      expect(report.donations[0]).toMatchObject({ payerName: "善心人士", amount: 5000 });
      const details = (await volunteer.get("/print/receipts/details").expect(200)).body;
      expect(details.items[0].description).toBe("建醮 捐款");
    });

    it.each([
      ["捐款類型不合法", { type: "BRIBE" }],
      ["金額為負", { amount: -1 }],
      ["數量為 0", { quantity: 0 }],
      ["廟宇 id 不是 UUID", { templeId: "x" }],
    ])("輸入驗證：%s → 400", async (_label, overrides) => {
      await donate(overrides, director).expect(400);
    });
  });

  // ───────────────────────────── 收據查詢／作廢／刪除 ─────────────────────────────
  describe("收據查詢", () => {
    it("可以用姓名或收據編號搜尋、用活動類型篩選、分頁", async () => {
      const { slots } = await createWallWithSlots(1);
      const member = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明");
      const lantern = await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", memberId: member.id, amount: 600 }).expect(201);
      await volunteer
        .post("/lantern/donations", { templeId: fx.templeId, walkInName: "李大華", type: DonationType.GENERAL, amount: 100 })
        .expect(201);
      await volunteer
        .post("/activities/submit", { donation: { templeId: fx.templeId, walkInName: "合併的人", type: DonationType.PUDU, amount: 50 } })
        .expect(201);

      const all = (await volunteer.get("/lantern/receipts").expect(200)).body;
      expect(all).toMatchObject({ total: 3, page: 1, pageSize: 20 });

      const byMember = (await volunteer.get(`/lantern/receipts?keyword=${encodeURIComponent("小明")}`).expect(200)).body;
      expect(byMember.items.map((r: { id: string }) => r.id)).toEqual([lantern.body.receipt.id]);
      const byWalkIn = (await volunteer.get(`/lantern/receipts?keyword=${encodeURIComponent("大華")}`).expect(200)).body;
      expect(byWalkIn.total).toBe(1);
      const byNo = (await volunteer.get(`/lantern/receipts?keyword=${lantern.body.receipt.receiptNo}`).expect(200)).body;
      expect(byNo.total).toBe(1);
      const none = (await volunteer.get(`/lantern/receipts?keyword=${encodeURIComponent("查無此人")}`).expect(200)).body;
      expect(none).toMatchObject({ total: 0, items: [] });

      // 捐款類型：單筆捐款收據 + 內含捐款的合併收據
      const donations = (await volunteer.get("/lantern/receipts?sourceType=DONATION").expect(200)).body;
      expect(donations.total).toBe(2);
      const lanterns = (await volunteer.get("/lantern/receipts?sourceType=LANTERN_CLAIM").expect(200)).body;
      expect(lanterns.total).toBe(1);

      const page2 = (await volunteer.get("/lantern/receipts?page=2&pageSize=2").expect(200)).body;
      expect(page2.items).toHaveLength(1);
      expect(page2.total).toBe(3);
    });
  });

  describe("收據作廢", () => {
    const issueLanternReceipt = async () => {
      const { wall, slots } = await createWallWithSlots(1);
      const res = await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "甲", amount: 600 }).expect(201);
      return { wall, receiptId: res.body.receipt.id as string };
    };

    it("財務可以作廢：收據變成已作廢，燈位釋出可以重新認領", async () => {
      const { wall, receiptId } = await issueLanternReceipt();
      const res = await finance.post(`/lantern/receipts/${receiptId}/void`, { reason: "金額打錯" }).expect(201);
      expect(res.body.status).toBe("VOIDED");

      const [slot] = await slotsOf(wall.id);
      expect(slot.status).toBe("EMPTY");
      await volunteer.post("/lantern/claims", { slotId: slot.id, lanternType: "光明燈", walkInName: "乙", amount: 600 }).expect(201);
    });

    it("志工、報名櫃檯不能作廢：403", async () => {
      const { receiptId } = await issueLanternReceipt();
      await volunteer.post(`/lantern/receipts/${receiptId}/void`, { reason: "金額打錯" }).expect(403);
      await api(app, fx.tokens[UserRole.REGISTRAR]).post(`/lantern/receipts/${receiptId}/void`, { reason: "金額打錯" }).expect(403);
    });

    it("邊界值：作廢原因至少 2 個字", async () => {
      const { receiptId } = await issueLanternReceipt();
      await finance.post(`/lantern/receipts/${receiptId}/void`, { reason: "錯" }).expect(400);
      await finance.post(`/lantern/receipts/${receiptId}/void`, {}).expect(400);
      await finance.post(`/lantern/receipts/${receiptId}/void`, { reason: "打錯" }).expect(201);
    });

    it("已作廢的收據不能再作廢：409；不存在的收據：404", async () => {
      const { receiptId } = await issueLanternReceipt();
      await finance.post(`/lantern/receipts/${receiptId}/void`, { reason: "打錯" }).expect(201);
      const again = await finance.post(`/lantern/receipts/${receiptId}/void`, { reason: "打錯" }).expect(409);
      expect(again.body.message).toBe("收據已經作廢過了");
      await finance.post(`/lantern/receipts/${GHOST_ID}/void`, { reason: "打錯" }).expect(404);
    });

    it("作廢合併收據：裡面的燈位與活動座位一起釋出", async () => {
      const { wall, slots } = await createWallWithSlots(1);
      const ceremony = (
        await director
          .post("/ceremony/ceremonies", {
            templeId: fx.templeId,
            name: "法會",
            date: "2099-01-01",
            feeMode: CeremonyFeeMode.FREE_WILL,
            tableCount: 1,
            seatsPerTable: 2,
          })
          .expect(201)
      ).body;
      const submitted = await volunteer
        .post("/activities/submit", {
          pendingLanternClaims: [{ slotId: slots[0].id, lanternType: "光明燈", walkInName: "甲", amount: 600 }],
          pendingCeremonyRegistrations: [{ ceremonyId: ceremony.id, walkInName: "甲", amount: 1000, seatIndex: 1 }],
        })
        .expect(201);

      await finance.post(`/lantern/receipts/${submitted.body.receipt.id}/void`, { reason: "全部取消" }).expect(201);

      expect((await slotsOf(wall.id))[0].status).toBe("EMPTY");
      const seats = (await volunteer.get(`/ceremony/ceremonies/${ceremony.id}/seats`).expect(200)).body;
      expect(seats.every((s: { status: string }) => s.status === "EMPTY")).toBe(true);
    });

    it("作廢的捐款不算進信徒的歷史紀錄", async () => {
      const member = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明");
      const res = await volunteer
        .post("/lantern/donations", { templeId: fx.templeId, memberId: member.id, type: DonationType.GENERAL, amount: 100 })
        .expect(201);
      expect((await volunteer.get(`/lantern/members/${member.id}/history`).expect(200)).body).toHaveLength(1);
      await finance.post(`/lantern/receipts/${res.body.receipt.id}/void`, { reason: "重複" }).expect(201);
      expect((await volunteer.get(`/lantern/members/${member.id}/history`).expect(200)).body).toEqual([]);
    });
  });

  describe("收據永久刪除（僅總幹事）", () => {
    it("刪除後收據與來源紀錄都消失；財務不能刪", async () => {
      const { wall, slots } = await createWallWithSlots(1);
      const res = await volunteer.post("/lantern/claims", { slotId: slots[0].id, lanternType: "光明燈", walkInName: "甲", amount: 600 }).expect(201);
      const receiptId = res.body.receipt.id;

      await finance.delete(`/lantern/receipts/${receiptId}`).expect(403);
      await director.delete(`/lantern/receipts/${receiptId}`).expect(200);

      expect((await volunteer.get("/lantern/receipts").expect(200)).body.total).toBe(0);
      expect((await slotsOf(wall.id))[0].status).toBe("EMPTY");
      await director.delete(`/lantern/receipts/${receiptId}`).expect(404);
    });
  });

  // ───────────────────────────── 列印 ─────────────────────────────
  describe("收據列印", () => {
    it("列印頁包含姓名、金額、備註與廟名；存根聯與收執聯各一份", async () => {
      const { slots } = await createWallWithSlots(1, "右牆");
      const submitted = await volunteer
        .post("/activities/submit", { pendingLanternClaims: [{ slotId: slots[0].id, lanternType: "光明燈", walkInName: "龔忠欣", amount: 600 }] })
        .expect(201);
      const res = await volunteer.get(`/print/receipt/${submitted.body.receipt.id}`).expect(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.text).toContain("感謝狀");
      expect(res.text).toContain("龔忠欣");
      expect(res.text).toContain("NT$ 600");
      expect(res.text).toContain("燈位：A-01");
      expect(res.text).toContain("測試宮");
      expect(res.text).toContain("存<br/>根<br/>聯");
      expect(res.text).toContain("收<br/>執<br/>聯");
      expect(res.text).not.toContain("作廢 VOID");
    });

    it("已作廢的收據列印時蓋上作廢章", async () => {
      const donated = await volunteer
        .post("/lantern/donations", { templeId: fx.templeId, walkInName: "甲", type: DonationType.GENERAL, amount: 100 })
        .expect(201);
      await finance.post(`/lantern/receipts/${donated.body.receipt.id}/void`, { reason: "打錯" }).expect(201);
      const res = await volunteer.get(`/print/receipt/${donated.body.receipt.id}`).expect(200);
      expect(res.text).toContain("作廢 VOID");
    });

    it("姓名裡的 HTML 會被跳脫，不會變成可執行的標籤（防 XSS）", async () => {
      const evil = `<script>alert("x")</script>`;
      const donated = await volunteer
        .post("/lantern/donations", { templeId: fx.templeId, walkInName: evil, type: DonationType.GENERAL, amount: 100 })
        .expect(201);
      const res = await volunteer.get(`/print/receipt/${donated.body.receipt.id}`).expect(200);
      expect(res.text).not.toContain(evil);
      expect(res.text).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    });

    it("匯出用的結構化資料", async () => {
      const donated = await volunteer
        .post("/lantern/donations", { templeId: fx.templeId, walkInName: "甲", type: DonationType.GENERAL, amount: 100 })
        .expect(201);
      const res = await volunteer.get(`/print/receipt/${donated.body.receipt.id}/data`).expect(200);
      expect(res.body).toMatchObject({
        receiptNo: donated.body.receipt.receiptNo,
        amount: 100,
        status: "ISSUED",
        payerName: "甲",
        templeName: "測試宮",
        committeeName: "測試宮",
        issuedByName: "測試-VOLUNTEER",
      });
    });

    it("收據不存在：404", async () => {
      await volunteer.get(`/print/receipt/${GHOST_ID}`).expect(404);
      await volunteer.get(`/print/lantern-label/${GHOST_ID}`).expect(404);
    });
  });
});
