import { INestApplication } from "@nestjs/common";
import { DonationType, InventoryTransactionType, LedgerEntryType, MemberTagType, UserRole } from "@tms/shared";
import { api, BaseFixture, createMember, createTestApp, resetDatabase, seedBaseFixture } from "../support/app";

const GHOST_ID = "00000000-0000-4000-8000-000000000000";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 黑箱測試：信徒與戶籍、庫存、財務流水帳與報表、廟宇設定。
 */
describe("信徒戶籍、庫存、財務、設定（黑箱／HTTP API）", () => {
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

  // ───────────────────────────── 信徒與戶籍 ─────────────────────────────
  describe("信徒與戶籍", () => {
    it("新增信徒：戶籍地址不存在就自動建立戶籍，地址相同歸到同一戶", async () => {
      const token = fx.tokens[UserRole.VOLUNTEER];
      const a = await createMember(app, token, "王爸爸", "嘉義縣中埔鄉1號");
      const b = await createMember(app, token, "王媽媽", "  嘉義縣中埔鄉1號  "); // 前後空白不影響歸戶
      const c = await createMember(app, token, "李先生", "嘉義縣中埔鄉2號");
      expect(b.householdId).toBe(a.householdId);
      expect(c.householdId).not.toBe(a.householdId);

      const households = (await volunteer.get("/households").expect(200)).body;
      expect(households).toHaveLength(2);
      const wang = households.find((h: { id: string }) => h.id === a.householdId);
      expect(wang).toMatchObject({ address: "嘉義縣中埔鄉1號", memberCount: 2 });
    });

    it("填國曆生日會自動換算農曆與生肖", async () => {
      const res = await volunteer
        .post("/members", { householdAddress: "A", name: "王小明", gender: "MALE", birthDateSolar: "1990-05-15" })
        .expect(201);
      expect(res.body).toMatchObject({ birthDateSolar: "1990-05-15", zodiac: "馬", birthDateLunar: "庚午年 四月廿一" });
    });

    it("手動填的農曆生日優先於自動換算", async () => {
      const res = await volunteer
        .post("/members", { householdAddress: "A", name: "王小明", gender: "MALE", birthDateSolar: "1990-05-15", birthDateLunar: "自訂農曆" })
        .expect(201);
      expect(res.body.birthDateLunar).toBe("自訂農曆");
    });

    it.each([
      ["不存在的日期（2 月 30 日）", { birthDateSolar: "1990-02-30" }],
      ["性別不合法", { gender: "X" }],
      ["缺少姓名", { name: undefined }],
      ["標籤不合法", { tags: ["VIP"] }],
    ])("新增信徒輸入驗證：%s → 400", async (_label, overrides) => {
      await volunteer.post("/members", { householdAddress: "A", name: "王小明", gender: "MALE", ...overrides }).expect(400);
    });

    it("戶長自動是戶內年紀最長的人；轉戶後兩邊的戶長重新計算", async () => {
      const young = (
        await volunteer.post("/members", { householdAddress: "甲戶", name: "年輕人", gender: "MALE", birthDateSolar: "2000-01-01" }).expect(201)
      ).body;
      const old = (
        await volunteer.post("/members", { householdAddress: "甲戶", name: "長輩", gender: "MALE", birthDateSolar: "1950-01-01" }).expect(201)
      ).body;
      const headOf = async (householdId: string) =>
        (await volunteer.get("/households").expect(200)).body.find((h: { id: string }) => h.id === householdId)?.headMemberId;
      expect(await headOf(young.householdId)).toBe(old.id);

      const other = (await volunteer.post("/households", { address: "乙戶" }).expect(201)).body;
      await volunteer.patch(`/members/${old.id}`, { householdId: other.id }).expect(200);
      expect(await headOf(young.householdId)).toBe(young.id);
      expect(await headOf(other.id)).toBe(old.id);

      await volunteer.patch(`/members/${young.id}`, { householdId: GHOST_ID }).expect(404);
    });

    it("搜尋信徒：姓名或電話的部分字串，支援分頁", async () => {
      await volunteer.post("/members", { householdAddress: "A", name: "王小明", gender: "MALE", phone: "0912345678" }).expect(201);
      await volunteer.post("/members", { householdAddress: "A", name: "王大明", gender: "MALE" }).expect(201);
      await volunteer.post("/members", { householdAddress: "B", name: "李小華", gender: "FEMALE" }).expect(201);

      const search = async (q: string) => (await volunteer.get(`/members?keyword=${encodeURIComponent(q)}`).expect(200)).body;
      expect((await search("王")).total).toBe(2);
      expect((await search("0912")).items.map((m: { name: string }) => m.name)).toEqual(["王小明"]);
      expect((await search("查無此人")).total).toBe(0);
      expect((await search("")).total).toBe(3);

      const paged = (await volunteer.get("/members?page=2&pageSize=2").expect(200)).body;
      expect(paged).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(paged.items).toHaveLength(1);
    });

    it("搜尋戶籍：用地址或戶內成員姓名都找得到；空白關鍵字不回傳任何戶籍", async () => {
      const m = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明", "嘉義縣中埔鄉1號");
      const search = async (q: string) => (await volunteer.get(`/households/search?keyword=${encodeURIComponent(q)}`).expect(200)).body;
      expect((await search("中埔")).items.map((h: { id: string }) => h.id)).toEqual([m.householdId]);
      expect((await search("小明")).items.map((h: { id: string }) => h.id)).toEqual([m.householdId]);
      expect((await search("  ")).total).toBe(0);
      expect((await volunteer.get(`/households/${m.householdId}/members`).expect(200)).body).toHaveLength(1);
    });

    it("編輯信徒與戶籍；不存在的資料 404", async () => {
      const m = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明");
      const updated = await volunteer.patch(`/members/${m.id}`, { name: "王曉明", phone: "", tags: [MemberTagType.LEGAL_MEMBER] }).expect(200);
      expect(updated.body).toMatchObject({ name: "王曉明", phone: null, tags: [MemberTagType.LEGAL_MEMBER] });
      const household = await volunteer.patch(`/households/${m.householdId}`, { address: "新地址", phone: "05-1234567" }).expect(200);
      expect(household.body).toMatchObject({ address: "新地址", phone: "05-1234567" });

      await volunteer.patch(`/members/${GHOST_ID}`, { name: "x" }).expect(404);
      await volunteer.patch(`/households/${GHOST_ID}`, { address: "x" }).expect(404);
      await volunteer.get(`/members/${GHOST_ID}`).expect(404);
    });

    it("刪除戶籍：戶內還有信徒 409，淨空後才能刪；只有總幹事可以刪", async () => {
      const m = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明");
      await volunteer.delete(`/households/${m.householdId}`).expect(403);
      const blocked = await director.delete(`/households/${m.householdId}`).expect(409);
      expect(blocked.body.message).toContain("還有 1 位信徒");
      await director.delete(`/members/${m.id}`).expect(200);
      await director.delete(`/households/${m.householdId}`).expect(200);
      await director.delete(`/households/${m.householdId}`).expect(404);
    });

    it("刪除信徒：有捐款／點燈／活動紀錄先 409 回報筆數，force 才刪", async () => {
      const m = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明");
      await volunteer
        .post("/lantern/donations", { templeId: fx.templeId, memberId: m.id, type: DonationType.GENERAL, amount: 100 })
        .expect(201);
      await volunteer.delete(`/members/${m.id}`).expect(403);
      const blocked = await director.delete(`/members/${m.id}`).expect(409);
      expect(blocked.body.historyCount).toBe(1);
      await director.delete(`/members/${m.id}?force=true`).expect(200);
      await volunteer.get(`/members/${m.id}`).expect(404);
      // 信徒刪掉後，舊收據仍然可以列印（姓名留空），不會整個壞掉
      const details = (await volunteer.get("/print/receipts/details").expect(200)).body;
      expect(details.items[0]).toMatchObject({ amount: 100, payerName: "" });
    });

    describe("一鍵匯入信徒", () => {
      const importRows = async (rows: Record<string, string>[]) =>
        (await volunteer.post("/households/import", { rows }).expect(201)).body;
      const allMembers = async () =>
        (await volunteer.get("/members?pageSize=100").expect(200)).body.items as Record<string, unknown>[];

      it("同地址歸同一戶；民國年生日換算成西元；性別與標籤的中文都看得懂", async () => {
        const result = await importRows([
          { householdAddress: "中埔1號", name: "王爸爸", gender: "男", birthDateSolar: "79/5/15", tags: "合法信徒、一般信徒" },
          { householdAddress: "中埔1號", name: "王媽媽", gender: "女", birthDateSolar: "1992-03-08" },
          { householdAddress: "中埔2號", name: "李先生", gender: "M" },
        ]);
        expect(result).toEqual({ successCount: 3, failedRows: [] });

        const members = await allMembers();
        const dad = members.find((m) => m.name === "王爸爸")!;
        const mom = members.find((m) => m.name === "王媽媽")!;
        expect(dad).toMatchObject({
          gender: "MALE",
          birthDateSolar: "1990-05-15",
          zodiac: "馬",
          tags: [MemberTagType.LEGAL_MEMBER, MemberTagType.GENERAL],
          address: "中埔1號",
        });
        expect(mom).toMatchObject({ gender: "FEMALE", birthDateSolar: "1992-03-08" });
        expect(mom.householdId).toBe(dad.householdId);
        expect((await volunteer.get("/households").expect(200)).body).toHaveLength(2);
      });

      it("看不懂或不存在的生日直接留空，不會擋下整筆資料", async () => {
        await importRows([
          { householdAddress: "A", name: "非閏年2/29", birthDateSolar: "2018/2/29" },
          { householdAddress: "A", name: "閏年2/29", birthDateSolar: "2020/2/29" },
          { householdAddress: "A", name: "亂寫", birthDateSolar: "不知道" },
          { householdAddress: "A", name: "月份13", birthDateSolar: "1990/13/1" },
          { householdAddress: "A", name: "後面有註記", birthDateSolar: "80/1/2 吉" },
        ]);
        const byName = new Map((await allMembers()).map((m) => [m.name, m.birthDateSolar]));
        expect(byName.get("非閏年2/29")).toBeNull();
        expect(byName.get("閏年2/29")).toBe("2020-02-29");
        expect(byName.get("亂寫")).toBeNull();
        expect(byName.get("月份13")).toBeNull();
        expect(byName.get("後面有註記")).toBe("1991-01-02");
      });

      it("有填戶號就以戶號分組；地址空白的資料各自成一戶", async () => {
        await importRows([
          { householdKey: "H1", householdAddress: "中埔1號", name: "甲" },
          { householdKey: "H1", householdAddress: "中埔一號", name: "乙" },
          { name: "沒地址1" },
          { name: "沒地址2" },
        ]);
        const members = await allMembers();
        const hid = (name: string) => members.find((m) => m.name === name)!.householdId;
        expect(hid("甲")).toBe(hid("乙"));
        expect(hid("沒地址1")).not.toBe(hid("沒地址2"));
      });

      it("資料建檔人員可以匯入；唯讀帳號不行", async () => {
        await api(app, fx.tokens[UserRole.DATA_ENTRY]).post("/households/import", { rows: [{ name: "甲" }] }).expect(201);
        await api(app, fx.tokens[UserRole.VIEWER]).post("/households/import", { rows: [{ name: "甲" }] }).expect(403);
        await volunteer.post("/households/import", { rows: "不是陣列" }).expect(400);
      });
    });
  });

  // ───────────────────────────── 庫存 ─────────────────────────────
  describe("庫存", () => {
    const createItem = async (overrides: Record<string, unknown> = {}) =>
      (await director.post("/inventory/items", { name: "金紙", unit: "包", lowStockThreshold: 10, initialStock: 20, ...overrides }).expect(201)).body;

    it("建立品項；只有總幹事可以建立、編輯、刪除", async () => {
      const item = await createItem();
      expect(item).toMatchObject({ name: "金紙", unit: "包", currentStock: 20, lowStockThreshold: 10, isLowStock: false });
      await volunteer.post("/inventory/items", { name: "香", unit: "支", lowStockThreshold: 1 }).expect(403);
      await volunteer.patch(`/inventory/items/${item.id}`, { name: "x", unit: "x", lowStockThreshold: 1 }).expect(403);
      await volunteer.delete(`/inventory/items/${item.id}`).expect(403);
    });

    it("沒填初始庫存預設 0", async () => {
      const item = await createItem({ initialStock: undefined, lowStockThreshold: 0 });
      expect(item).toMatchObject({ currentStock: 0, isLowStock: true });
    });

    it("邊界值：庫存剛好等於安全存量就算低庫存，多 1 就不算", async () => {
      const atThreshold = await createItem({ name: "剛好", initialStock: 10, lowStockThreshold: 10 });
      const above = await createItem({ name: "多一", initialStock: 11, lowStockThreshold: 10 });
      expect(atThreshold.isLowStock).toBe(true);
      expect(above.isLowStock).toBe(false);
      const low = (await volunteer.get("/inventory/items/low-stock").expect(200)).body;
      expect(low.map((i: { name: string }) => i.name)).toEqual(["剛好"]);
    });

    it("進貨增加庫存、領用減少庫存，並留下異動紀錄", async () => {
      const item = await createItem({ initialStock: 5 });
      const afterIn = await volunteer.post(`/inventory/items/${item.id}/adjust`, { type: InventoryTransactionType.IN, quantity: 10, note: "補貨" }).expect(201);
      expect(afterIn.body.currentStock).toBe(15);
      const afterOut = await volunteer.post(`/inventory/items/${item.id}/adjust`, { type: InventoryTransactionType.OUT, quantity: 4 }).expect(201);
      expect(afterOut.body.currentStock).toBe(11);

      const txs = (await volunteer.get(`/inventory/items/${item.id}/transactions`).expect(200)).body;
      expect(txs).toHaveLength(2);
      expect(txs.map((t: { type: string; quantity: number }) => [t.type, t.quantity]).sort()).toEqual([["IN", 10], ["OUT", 4]].sort());
      expect(txs[0]).toMatchObject({ itemName: "金紙", createdByName: "測試-VOLUNTEER" });
    });

    it("邊界值：剛好領完可以（庫存變 0），多領 1 個就 409，而且庫存不會變成負數", async () => {
      const item = await createItem({ initialStock: 3 });
      const adjust = (quantity: number) =>
        volunteer.post(`/inventory/items/${item.id}/adjust`, { type: InventoryTransactionType.OUT, quantity });

      const over = await adjust(4).expect(409);
      expect(over.body.message).toBe("庫存不足，無法領用此數量");
      expect((await adjust(3).expect(201)).body.currentStock).toBe(0);
      await adjust(1).expect(409);
      // 失敗的領用不會留下異動紀錄
      expect((await volunteer.get(`/inventory/items/${item.id}/transactions`).expect(200)).body).toHaveLength(1);
    });

    it("兩個人同時領用：庫存只夠一個人時，只有一個成功", async () => {
      const item = await createItem({ initialStock: 5 });
      const results = await Promise.all([
        volunteer.post(`/inventory/items/${item.id}/adjust`, { type: InventoryTransactionType.OUT, quantity: 4 }),
        finance.post(`/inventory/items/${item.id}/adjust`, { type: InventoryTransactionType.OUT, quantity: 4 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const [listed] = (await volunteer.get("/inventory/items").expect(200)).body;
      expect(listed.currentStock).toBe(1);
    });

    it.each([
      ["數量 0（至少 1）", { quantity: 0 }],
      ["數量不是整數", { quantity: 1.5 }],
      ["類型不合法", { type: "STEAL" }],
    ])("異動輸入驗證：%s → 400", async (_label, overrides) => {
      const item = await createItem();
      await volunteer.post(`/inventory/items/${item.id}/adjust`, { type: InventoryTransactionType.IN, quantity: 1, ...overrides }).expect(400);
    });

    it("編輯品項；改成跟別的品項同名 409；刪除後連異動紀錄一起消失", async () => {
      const a = await createItem({ name: "金紙" });
      const b = await createItem({ name: "線香" });
      const renamed = await director.patch(`/inventory/items/${a.id}`, { name: "大金紙", unit: "箱", lowStockThreshold: 3 }).expect(200);
      expect(renamed.body).toMatchObject({ name: "大金紙", unit: "箱", lowStockThreshold: 3 });
      await director.patch(`/inventory/items/${b.id}`, { name: "大金紙", unit: "包", lowStockThreshold: 3 }).expect(409);

      await director.delete(`/inventory/items/${a.id}`).expect(200);
      await director.delete(`/inventory/items/${a.id}`).expect(404);
      await volunteer.post(`/inventory/items/${a.id}/adjust`, { type: InventoryTransactionType.IN, quantity: 1 }).expect(404);
    });
  });

  // ───────────────────────────── 財務 ─────────────────────────────
  describe("財務流水帳與報表", () => {
    const createEntry = async (overrides: Record<string, unknown> = {}, client = volunteer) =>
      (
        await client
          .post("/finance/ledger-entries", {
            templeId: fx.templeId,
            type: LedgerEntryType.EXPENSE,
            category: "水電",
            amount: 1000,
            occurredAt: today(),
            ...overrides,
          })
          .expect(201)
      ).body;
    const approve = (id: string) => finance.post(`/finance/ledger-entries/${id}/review`, { action: "APPROVE" }).expect(201);

    it("志工可以新增流水帳（待審核），但不能查看或審核", async () => {
      const entry = await createEntry();
      expect(entry).toMatchObject({ status: "PENDING", amount: 1000, category: "水電", createdByName: "測試-VOLUNTEER" });
      await volunteer.get("/finance/ledger-entries").expect(403);
      await volunteer.post(`/finance/ledger-entries/${entry.id}/review`, { action: "APPROVE" }).expect(403);
      expect((await finance.get("/finance/ledger-entries?status=PENDING").expect(200)).body).toHaveLength(1);
    });

    it("審核：核准、駁回一定要寫原因、已審核過的不能再審", async () => {
      const a = await createEntry();
      const b = await createEntry();
      const approved = await approve(a.id);
      expect(approved.body).toMatchObject({ status: "APPROVED", reviewedByName: "測試-FINANCE" });

      await finance.post(`/finance/ledger-entries/${b.id}/review`, { action: "REJECT" }).expect(400);
      const rejected = await finance.post(`/finance/ledger-entries/${b.id}/review`, { action: "REJECT", reason: "沒有單據" }).expect(201);
      expect(rejected.body).toMatchObject({ status: "REJECTED", reviewedReason: "沒有單據" });

      await finance.post(`/finance/ledger-entries/${a.id}/review`, { action: "APPROVE" }).expect(409);
      await finance.post(`/finance/ledger-entries/${a.id}/review`, { action: "MAYBE" }).expect(400);
      await finance.post(`/finance/ledger-entries/${GHOST_ID}/review`, { action: "APPROVE" }).expect(404);
    });

    it("批次核准只處理還在待審核的項目", async () => {
      const a = await createEntry();
      const b = await createEntry();
      await approve(a.id);
      const res = await finance.post("/finance/ledger-entries/batch-review", { ids: [a.id, b.id] }).expect(201);
      expect(res.body).toEqual({ approvedCount: 1 });
      expect((await finance.post("/finance/ledger-entries/batch-review", { ids: [] }).expect(201)).body).toEqual({ approvedCount: 0 });
    });

    it.each([
      ["金額為負", { amount: -1 }],
      ["類型不合法", { type: "GIFT" }],
      ["日期格式錯誤", { occurredAt: "昨天" }],
      ["分類超過 100 字", { category: "長".repeat(101) }],
    ])("新增流水帳輸入驗證：%s → 400", async (_label, overrides) => {
      await volunteer
        .post("/finance/ledger-entries", { templeId: fx.templeId, type: LedgerEntryType.EXPENSE, category: "水電", amount: 1, occurredAt: today(), ...overrides })
        .expect(400);
    });

    it("邊界值：分類剛好 100 字可以", async () => {
      await createEntry({ category: "長".repeat(100) });
    });

    it("剩餘零用金 = 撥補 − 從零用金支出；駁回的不算；歸零後重新起算", async () => {
      const balance = async () =>
        (await volunteer.get(`/finance/ledger-entries/petty-cash-balance?templeId=${fx.templeId}`).expect(200)).body.balance;
      expect(await balance()).toBe(0);

      await createEntry({ category: "零用金撥補", amount: 5000 });
      await createEntry({ category: "文具", amount: 300, isPettyCash: true });
      const rejectedDraw = await createEntry({ category: "餐費", amount: 999, isPettyCash: true });
      expect(await balance()).toBe(5000 - 300 - 999);

      await finance.post(`/finance/ledger-entries/${rejectedDraw.id}/review`, { action: "REJECT", reason: "不合規定" }).expect(201);
      expect(await balance()).toBe(4700);

      await volunteer.post("/finance/ledger-entries/petty-cash-reset", { templeId: fx.templeId }).expect(403);
      const reset = await finance.post("/finance/ledger-entries/petty-cash-reset", { templeId: fx.templeId }).expect(201);
      expect(reset.body).toEqual({ balance: 0 });
      await finance.post("/finance/ledger-entries/petty-cash-reset", { templeId: GHOST_ID }).expect(404);
    });

    it("每日結帳：收據收入 + 已核准的流水帳；待審核與已作廢的不算，零用金支出單獨列出", async () => {
      // 收據收入：捐款 1000（有效）+ 捐款 300（作廢）
      await volunteer.post("/lantern/donations", { templeId: fx.templeId, walkInName: "甲", type: DonationType.GENERAL, amount: 1000 }).expect(201);
      const voided = await volunteer.post("/lantern/donations", { templeId: fx.templeId, walkInName: "乙", type: DonationType.PUDU, amount: 300 }).expect(201);
      await finance.post(`/lantern/receipts/${voided.body.receipt.id}/void`, { reason: "打錯" }).expect(201);

      // 流水帳：核准收入 200、核准支出 150、核准的零用金支出 50、待審核支出 9999
      await approve((await createEntry({ type: LedgerEntryType.INCOME, category: "金紙販售", amount: 200 })).id);
      await approve((await createEntry({ category: "水電", amount: 150 })).id);
      await approve((await createEntry({ category: "文具", amount: 50, isPettyCash: true })).id);
      await createEntry({ category: "尚未審核", amount: 9999 });

      const report = (await finance.get(`/finance/reports/daily?date=${today()}&templeId=${fx.templeId}`).expect(200)).body;
      expect(report).toMatchObject({
        periodLabel: today(),
        lanternAndDonationIncome: 1000,
        ledgerIncome: 200,
        totalIncome: 1200,
        totalExpense: 150,
        netAmount: 1050,
        pendingEntryCount: 1,
        pettyCashExpenseTotal: 50,
      });
      expect(report.lanternIncomeByCategory).toEqual([{ label: "一般捐款", amount: 1000 }]);
      expect(report.incomeDetails).toHaveLength(1);
      expect(report.incomeDetails[0]).toMatchObject({ payerName: "甲", amount: 1000 });
      expect(report.expenseByCategory).toEqual([{ category: "水電", amount: 150 }]);
      expect(report.pettyCashExpenseDetails).toHaveLength(1);
    });

    it("月報、區間、年度報表涵蓋今天的資料；別間廟的資料不會混進來", async () => {
      await volunteer.post("/lantern/donations", { templeId: fx.templeId, walkInName: "甲", type: DonationType.GENERAL, amount: 1000 }).expect(201);
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth() + 1;

      const monthly = (await finance.get(`/finance/reports/monthly?year=${y}&month=${m}`).expect(200)).body;
      expect(monthly).toMatchObject({ periodLabel: `${y}-${String(m).padStart(2, "0")}`, totalIncome: 1000 });
      const annual = (await finance.get(`/finance/reports/annual?year=${y}`).expect(200)).body;
      expect(annual).toMatchObject({ periodLabel: `${y}`, totalIncome: 1000 });
      const range = (await finance.get(`/finance/reports/range?start=${today()}&end=${today()}`).expect(200)).body;
      expect(range).toMatchObject({ periodLabel: `${today()} ~ ${today()}`, totalIncome: 1000 });
      const lastYear = (await finance.get(`/finance/reports/annual?year=${y - 1}`).expect(200)).body;
      expect(lastYear.totalIncome).toBe(0);
      const otherTemple = (await finance.get(`/finance/reports/daily?date=${today()}&templeId=${GHOST_ID}`).expect(200)).body;
      expect(otherTemple.totalIncome).toBe(0);
    });

    it("報名櫃檯人員只能看每日結帳，不能看月報", async () => {
      const registrar = api(app, fx.tokens[UserRole.REGISTRAR]);
      await registrar.get(`/finance/reports/daily?date=${today()}`).expect(200);
      await registrar.get("/finance/reports/monthly?year=2026&month=1").expect(403);
      await volunteer.get(`/finance/reports/daily?date=${today()}`).expect(403);
    });

    it("審核日誌：彙總每天的待審核／已核准筆數與是否有收據收入；確認入帳後標記為已審核", async () => {
      await createEntry();
      await approve((await createEntry()).id);
      await volunteer.post("/lantern/donations", { templeId: fx.templeId, walkInName: "甲", type: DonationType.GENERAL, amount: 1 }).expect(201);

      const url = `/finance/ledger-entries/audit-calendar?from=${today()}&to=${today()}&templeId=${fx.templeId}`;
      const before = (await finance.get(url).expect(200)).body;
      expect(before).toEqual([
        { date: today(), pendingCount: 1, approvedCount: 1, rejectedCount: 0, hasReceiptIncome: true, audited: false },
      ]);

      const confirmed = await finance.post("/finance/ledger-entries/confirm-audit", { templeId: fx.templeId, dates: [today(), today()] }).expect(201);
      expect(confirmed.body).toEqual({ auditedDates: [today()] });
      expect((await finance.get(url).expect(200)).body[0].audited).toBe(true);

      // 沒指定廟宇不能看審核日誌
      await finance.get(`/finance/ledger-entries/audit-calendar?from=${today()}&to=${today()}`).expect(400);
      await finance.post("/finance/ledger-entries/confirm-audit", { templeId: fx.templeId, dates: [] }).expect(400);
    });

    it("列入活動計算的支出會出現在活動報表（核准後才算）", async () => {
      const ceremony = (
        await director.post("/ceremony/ceremonies", { templeId: fx.templeId, name: "法會", date: "2099-01-01", feeMode: "FREE_WILL" }).expect(201)
      ).body;
      const entry = await createEntry({ category: "供品", amount: 800, ceremonyId: ceremony.id });
      const reportUrl = `/ceremony/ceremonies/${ceremony.id}/report`;
      expect((await volunteer.get(reportUrl).expect(200)).body.expenseTotal).toBe(0);
      await approve(entry.id);
      const report = (await volunteer.get(reportUrl).expect(200)).body;
      expect(report.expenseTotal).toBe(800);
      expect(report.expenses[0]).toMatchObject({ category: "供品", amount: 800 });
    });
  });

  // ───────────────────────────── 廟宇設定 ─────────────────────────────
  describe("廟宇設定", () => {
    it("列出廟宇、讀取與更新設定；只有總幹事可以改", async () => {
      expect((await volunteer.get("/temples").expect(200)).body).toEqual([{ id: fx.templeId, name: "中埔" }]);
      const before = (await volunteer.get(`/settings/${fx.templeId}`).expect(200)).body;
      expect(before).toMatchObject({ templeName: "測試宮", chairmanTitle: "主任委員", address: null });

      await volunteer.put(`/settings/${fx.templeId}`, { templeName: "被改掉" }).expect(403);
      const updated = await director.put(`/settings/${fx.templeId}`, { templeName: "中埔天后宮", address: "嘉義縣", phone: "05-1234567" }).expect(200);
      expect(updated.body).toMatchObject({ templeName: "中埔天后宮", address: "嘉義縣", phone: "05-1234567" });

      await director.get(`/settings/${GHOST_ID}`).expect(404);
      await director.put(`/settings/${GHOST_ID}`, { templeName: "x" }).expect(404);
    });

    it("上傳印信：沒選檔案或格式不是圖片 → 400", async () => {
      await director.post(`/settings/${fx.templeId}/temple-seal`).expect(400);
    });
  });
});
