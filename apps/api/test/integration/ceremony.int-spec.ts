import { INestApplication } from "@nestjs/common";
import { CeremonyFeeMode, CeremonyKind, CeremonySession, UserRole } from "@tms/shared";
import { api, BaseFixture, createMember, createTestApp, resetDatabase, seedBaseFixture } from "../support/app";

/** 距離今天 offset 天的日期字串（YYYY-MM-DD，本地時間） */
function dateFromToday(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 黑箱測試：活動（一般活動／祭改／進香）建立與報名。
 * 全部透過 HTTP API 操作，接真的 PostgreSQL，所以資料庫的唯一約束（搶位、撞號）也一併驗證到。
 */
describe("活動建立與報名（黑箱／HTTP API）", () => {
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

  const createCeremony = async (overrides: Record<string, unknown> = {}) => {
    const res = await director
      .post("/ceremony/ceremonies", {
        templeId: fx.templeId,
        name: "中元普渡",
        date: dateFromToday(30),
        feeMode: CeremonyFeeMode.FREE_WILL,
        ...overrides,
      })
      .expect(201);
    return res.body;
  };

  /** 走「活動報名」頁實際使用的合併送出 API，回傳整個回應（含收據） */
  const submitRegistrations = (registrations: Record<string, unknown>[], client = volunteer) =>
    client.post("/activities/submit", { pendingCeremonyRegistrations: registrations });

  const seatMap = async (ceremonyId: string) =>
    (await volunteer.get(`/ceremony/ceremonies/${ceremonyId}/seats`).expect(200)).body as {
      seatIndex: number;
      tableNumber: number;
      seatInTable: number;
      status: "EMPTY" | "TAKEN";
      participantName?: string;
    }[];

  // ───────────────────────────── 建立／編輯／刪除 ─────────────────────────────
  describe("建立活動", () => {
    it("一般活動：桌數 × 每桌人數 = 座位總數", async () => {
      const c = await createCeremony({ tableCount: 2, seatsPerTable: 3 });
      expect(c).toMatchObject({
        kind: CeremonyKind.GENERAL,
        tableCount: 2,
        seatsPerTable: 3,
        totalSeats: 6,
        seatsAssigned: 0,
        registrationCount: 0,
        totalAmount: 0,
      });
    });

    it("未設定桌數：沒有座位", async () => {
      const c = await createCeremony();
      expect(c.totalSeats).toBeNull();
    });

    it("固定金額活動會記下金額", async () => {
      const c = await createCeremony({ feeMode: CeremonyFeeMode.FIXED_AMOUNT, fixedAmount: 1200 });
      expect(c).toMatchObject({ feeMode: CeremonyFeeMode.FIXED_AMOUNT, fixedAmount: 1200 });
    });

    it("只有總幹事可以建立活動", async () => {
      const body = { templeId: fx.templeId, name: "x", date: dateFromToday(1), feeMode: CeremonyFeeMode.FREE_WILL };
      await volunteer.post("/ceremony/ceremonies", body).expect(403);
      await api(app, fx.tokens[UserRole.FINANCE]).post("/ceremony/ceremonies", body).expect(403);
      await api(app, fx.tokens[UserRole.REGISTRAR]).post("/ceremony/ceremonies", body).expect(403);
    });

    it.each([
      ["缺少名稱", { name: undefined }],
      ["日期格式錯誤", { date: "下週三" }],
      ["收費方式不是合法值", { feeMode: "FREE" }],
      ["桌數為 0（邊界：必須是正整數）", { tableCount: 0 }],
      ["每桌人數為負數", { seatsPerTable: -1 }],
      ["桌數不是整數", { tableCount: 1.5 }],
      ["固定金額為負數", { fixedAmount: -1 }],
      ["活動種類不是合法值", { kind: "PARTY" }],
      ["廟宇 id 不是 UUID", { templeId: "abc" }],
    ])("輸入驗證：%s → 400", async (_label, overrides) => {
      await director
        .post("/ceremony/ceremonies", {
          templeId: fx.templeId,
          name: "活動",
          date: dateFromToday(1),
          feeMode: CeremonyFeeMode.FREE_WILL,
          ...overrides,
        })
        .expect(400);
    });
  });

  describe("活動列表與報名期限", () => {
    it("activeOnly 只列出尚未過期的活動：有期限看期限，沒期限看活動日期", async () => {
      await createCeremony({ name: "未來活動", date: dateFromToday(10) });
      await createCeremony({ name: "已過日期", date: dateFromToday(-1) });
      await createCeremony({ name: "今天舉辦", date: dateFromToday(0) });
      await createCeremony({ name: "期限已過", date: dateFromToday(10), registrationDeadline: dateFromToday(-1) });
      await createCeremony({ name: "期限今天", date: dateFromToday(10), registrationDeadline: dateFromToday(0) });

      const all = await volunteer.get("/ceremony/ceremonies").expect(200);
      expect(all.body).toHaveLength(5);

      const active = await volunteer.get("/ceremony/ceremonies?activeOnly=true").expect(200);
      expect(active.body.map((c: { name: string }) => c.name).sort()).toEqual(["今天舉辦", "未來活動", "期限今天"].sort());
    });

    it("可以用 templeId 篩選", async () => {
      await createCeremony();
      const other = await volunteer.get("/ceremony/ceremonies?templeId=00000000-0000-4000-8000-000000000000").expect(200);
      expect(other.body).toEqual([]);
      const mine = await volunteer.get(`/ceremony/ceremonies?templeId=${fx.templeId}`).expect(200);
      expect(mine.body).toHaveLength(1);
    });
  });

  // ───────────────────────────── 一般活動報名 ─────────────────────────────
  describe("一般活動報名與座位", () => {
    it("沒有指定座位：依序自動配位，收據金額正確", async () => {
      const c = await createCeremony({ tableCount: 2, seatsPerTable: 2 });
      const a = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明");

      const first = await volunteer
        .post("/ceremony/registrations", { ceremonyId: c.id, memberId: a.id, amount: 500 })
        .expect(201);
      expect(first.body.registration).toMatchObject({ participantName: "王小明", seatNumber: "1-1", amount: 500 });
      expect(first.body.receipt).toMatchObject({ amount: 500, status: "ISSUED", sourceType: "CEREMONY_REGISTRATION" });
      expect(first.body.receipt.receiptNo).toMatch(/^R\d{8}\d{6}$/);

      const seats = ["1-2", "2-1", "2-2"];
      for (const expected of seats) {
        const res = await volunteer
          .post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "臨櫃", amount: 100 })
          .expect(201);
        expect(res.body.registration.seatNumber).toBe(expected);
      }
    });

    it("座位全滿後仍可報名，只是不再配位（需人工安排）", async () => {
      const c = await createCeremony({ tableCount: 1, seatsPerTable: 1 });
      await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount: 100 }).expect(201);
      const second = await volunteer
        .post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "乙", amount: 100 })
        .expect(201);
      expect(second.body.registration.seatNumber).toBeNull();
    });

    it("手動選位：座位流水號的邊界值（0、1、最後一個、超出一個）", async () => {
      const c = await createCeremony({ tableCount: 2, seatsPerTable: 3 }); // 座位 1～6
      const reg = (seatIndex: number) =>
        volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount: 100, seatIndex });

      await reg(0).expect(400);
      await reg(7).expect(400);
      expect((await reg(1).expect(201)).body.registration.seatNumber).toBe("1-1");
      expect((await reg(6).expect(201)).body.registration.seatNumber).toBe("2-3");
    });

    it("同一個座位第二個人選：409，不會重複入座", async () => {
      const c = await createCeremony({ tableCount: 1, seatsPerTable: 2 });
      const body = { ceremonyId: c.id, walkInName: "甲", amount: 100, seatIndex: 1 };
      await volunteer.post("/ceremony/registrations", body).expect(201);
      const res = await volunteer.post("/ceremony/registrations", { ...body, walkInName: "乙" }).expect(409);
      expect(res.body.message).toBe("此座位已被選走，請重新選擇");

      const seats = await seatMap(c.id);
      expect(seats.filter((s) => s.status === "TAKEN")).toHaveLength(1);
      expect(seats[0]).toMatchObject({ seatIndex: 1, status: "TAKEN", participantName: "甲" });
    });

    it("自動配位會跳過已被手動選走的座位", async () => {
      const c = await createCeremony({ tableCount: 1, seatsPerTable: 3 });
      await volunteer
        .post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "手動", amount: 100, seatIndex: 1 })
        .expect(201);
      const auto = await volunteer
        .post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "自動", amount: 100 })
        .expect(201);
      expect(auto.body.registration.seatNumber).toBe("1-2");
    });

    it("沒有設定座位的活動指定座位：400", async () => {
      const c = await createCeremony();
      await volunteer
        .post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount: 100, seatIndex: 1 })
        .expect(400);
    });

    it("不需要座位（noSeatNeeded）：不佔用座位", async () => {
      const c = await createCeremony({ tableCount: 1, seatsPerTable: 2 });
      const res = await volunteer
        .post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "純捐款", amount: 100, noSeatNeeded: true })
        .expect(201);
      expect(res.body.registration.seatNumber).toBeNull();
      const [listed] = (await volunteer.get("/ceremony/ceremonies").expect(200)).body;
      expect(listed).toMatchObject({ registrationCount: 1, seatsAssigned: 0 });
    });

    it("報名不存在的活動／信徒：404；金額為負數：400", async () => {
      const c = await createCeremony();
      const ghost = "00000000-0000-4000-8000-000000000000";
      await volunteer.post("/ceremony/registrations", { ceremonyId: ghost, walkInName: "甲", amount: 1 }).expect(404);
      await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, memberId: ghost, amount: 1 }).expect(404);
      await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount: -1 }).expect(400);
      // 金額 0 是合法的（隨喜）
      await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount: 0 }).expect(201);
    });

    it("認領整桌：整桌座位都被保留，收據印「第X桌」，之後別人不能選這桌的座位", async () => {
      const c = await createCeremony({ tableCount: 2, seatsPerTable: 3 });
      const m = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "林老闆");

      const res = await submitRegistrations([{ ceremonyId: c.id, memberId: m.id, amount: 3000, tableNumber: 2 }]).expect(201);
      expect(res.body.receipt).toMatchObject({ amount: 3000, payerName: "林老闆" });
      expect(res.body.receipt.items[0]).toMatchObject({ description: "中元普渡", amount: 3000, note: "第2桌" });

      const seats = await seatMap(c.id);
      expect(seats.filter((s) => s.tableNumber === 2).every((s) => s.status === "TAKEN")).toBe(true);
      expect(seats.filter((s) => s.tableNumber === 1).every((s) => s.status === "EMPTY")).toBe(true);

      await volunteer
        .post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "乙", amount: 100, seatIndex: 4 })
        .expect(409);
      // 只算一筆金額，不會因為佔了三個座位就算三次
      const report = (await volunteer.get(`/ceremony/ceremonies/${c.id}/report`).expect(200)).body;
      expect(report.totalAmount).toBe(3000);
    });

    it("認領整桌：桌號超出範圍 400；該桌已有人入座 409", async () => {
      const c = await createCeremony({ tableCount: 2, seatsPerTable: 2 });
      await submitRegistrations([{ ceremonyId: c.id, walkInName: "甲", amount: 1, tableNumber: 3 }]).expect(400);

      await volunteer
        .post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "乙", amount: 1, seatIndex: 2 })
        .expect(201);
      await submitRegistrations([{ ceremonyId: c.id, walkInName: "甲", amount: 1, tableNumber: 1 }]).expect(409);
      // 整桌認領失敗時不會留下半套佔位
      expect((await seatMap(c.id)).filter((s) => s.status === "TAKEN")).toHaveLength(1);
    });

    it("整戶報名：戶內每人一筆、金額平均分攤，收據合併成「活動*n人」", async () => {
      const c = await createCeremony({ tableCount: 1, seatsPerTable: 4 });
      const token = fx.tokens[UserRole.VOLUNTEER];
      const dad = await createMember(app, token, "陳爸爸", "陳家");
      await createMember(app, token, "陳媽媽", "陳家");

      // 選位數量與戶內人數不符
      await submitRegistrations([
        { ceremonyId: c.id, householdId: dad.householdId, amount: 1000, householdSeatIndexes: [1] },
      ]).expect(400);

      const res = await submitRegistrations([
        { ceremonyId: c.id, householdId: dad.householdId, amount: 1000, householdSeatIndexes: [1, 2] },
      ]).expect(201);
      expect(res.body.receipt).toMatchObject({ amount: 1000, payerName: "陳爸爸、陳媽媽" });
      expect(res.body.receipt.items[0]).toMatchObject({ description: "中元普渡*2人", note: "座位｜1桌1號、1桌2號" });
      expect(res.body.ceremonyRegistrations.map((r: { amount: number }) => r.amount)).toEqual([500, 500]);
    });

    it("整戶報名：戶籍沒有信徒 → 400", async () => {
      const c = await createCeremony();
      const household = (await volunteer.post("/households", { address: "空屋" }).expect(201)).body;
      await submitRegistrations([{ ceremonyId: c.id, householdId: household.id, amount: 100 }]).expect(400);
    });
  });

  describe("編輯與刪除活動", () => {
    it("已有人報名後不能改每桌人數；桌數可以加、不能縮到低於已配發的座位", async () => {
      const c = await createCeremony({ tableCount: 2, seatsPerTable: 2 });
      await volunteer
        .post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount: 1, seatIndex: 3 })
        .expect(201);

      await director.patch(`/ceremony/ceremonies/${c.id}`, { seatsPerTable: 5 }).expect(400);
      await director.patch(`/ceremony/ceremonies/${c.id}`, { tableCount: 1 }).expect(400);
      const grown = await director.patch(`/ceremony/ceremonies/${c.id}`, { tableCount: 5 }).expect(200);
      expect(grown.body).toMatchObject({ tableCount: 5, totalSeats: 10, registrationCount: 1 });
    });

    it("可以改名稱、日期、收費方式；改成隨喜時清掉固定金額", async () => {
      const c = await createCeremony({ feeMode: CeremonyFeeMode.FIXED_AMOUNT, fixedAmount: 500 });
      const res = await director
        .patch(`/ceremony/ceremonies/${c.id}`, { name: "新名稱", feeMode: CeremonyFeeMode.FREE_WILL })
        .expect(200);
      expect(res.body).toMatchObject({ name: "新名稱", feeMode: CeremonyFeeMode.FREE_WILL, fixedAmount: null });
    });

    it("刪除：沒有報名直接刪；有報名先 409 回報筆數，force 才會刪", async () => {
      const empty = await createCeremony({ name: "空活動" });
      await director.delete(`/ceremony/ceremonies/${empty.id}`).expect(200);

      const c = await createCeremony();
      await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount: 1 }).expect(201);
      const blocked = await director.delete(`/ceremony/ceremonies/${c.id}`).expect(409);
      expect(blocked.body.registrationCount).toBe(1);
      await director.delete(`/ceremony/ceremonies/${c.id}?force=true`).expect(200);
      expect((await volunteer.get("/ceremony/ceremonies").expect(200)).body).toEqual([]);
    });

    it("編輯／刪除不存在的活動：404；志工不能編輯或刪除：403", async () => {
      const ghost = "00000000-0000-4000-8000-000000000000";
      await director.patch(`/ceremony/ceremonies/${ghost}`, { name: "x" }).expect(404);
      await director.delete(`/ceremony/ceremonies/${ghost}`).expect(404);
      const c = await createCeremony();
      await volunteer.patch(`/ceremony/ceremonies/${c.id}`, { name: "x" }).expect(403);
      await volunteer.delete(`/ceremony/ceremonies/${c.id}`).expect(403);
    });
  });

  // ───────────────────────────── 祭改 ─────────────────────────────
  describe("祭改（上午／下午場、人數上限、場次號碼）", () => {
    const createJigai = (morningCapacity = 3, afternoonCapacity = 3) =>
      createCeremony({ name: "祭改", kind: CeremonyKind.JIGAI, morningCapacity, afternoonCapacity });

    const register = (ceremonyId: string, session: CeremonySession | undefined, name = "甲") =>
      submitRegistrations([{ ceremonyId, walkInName: name, amount: 300, session }]);

    it("建立時必須設定上午、下午場人數；不使用桌次", async () => {
      const base = {
        templeId: fx.templeId,
        name: "祭改",
        date: dateFromToday(5),
        feeMode: CeremonyFeeMode.FREE_WILL,
        kind: CeremonyKind.JIGAI,
      };
      await director.post("/ceremony/ceremonies", base).expect(400);
      await director.post("/ceremony/ceremonies", { ...base, morningCapacity: 10 }).expect(400);
      await director.post("/ceremony/ceremonies", { ...base, morningCapacity: 0, afternoonCapacity: 10 }).expect(400);

      const c = await createCeremony({ kind: CeremonyKind.JIGAI, morningCapacity: 10, afternoonCapacity: 20, tableCount: 5, seatsPerTable: 5 });
      expect(c).toMatchObject({
        kind: CeremonyKind.JIGAI,
        morningCapacity: 10,
        afternoonCapacity: 20,
        morningRegistered: 0,
        afternoonRegistered: 0,
        tableCount: null,
        totalSeats: null,
      });
    });

    it("每一場各自從 1 號開始依序給號，收據上印場次與號碼", async () => {
      const c = await createJigai();
      const am1 = await register(c.id, CeremonySession.AM, "甲").expect(201);
      const am2 = await register(c.id, CeremonySession.AM, "乙").expect(201);
      const pm1 = await register(c.id, CeremonySession.PM, "丙").expect(201);

      expect(am1.body.ceremonyRegistration).toMatchObject({ session: "AM", queueNumber: 1 });
      expect(am1.body.receipt.items[0]).toMatchObject({ description: "祭改", note: "甲，上午場 1號", amount: 300 });
      expect(am2.body.receipt.items[0].note).toBe("乙，上午場 2號");
      expect(pm1.body.receipt.items[0].note).toBe("丙，下午場 1號");

      const [listed] = (await volunteer.get("/ceremony/ceremonies").expect(200)).body;
      expect(listed).toMatchObject({ morningRegistered: 2, afternoonRegistered: 1, registrationCount: 3 });
    });

    it("邊界值：人數上限 2 → 第 2 位可以報、第 3 位被擋（409），另一場不受影響", async () => {
      const c = await createJigai(2, 1);
      await register(c.id, CeremonySession.AM).expect(201);
      await register(c.id, CeremonySession.AM).expect(201);
      const full = await register(c.id, CeremonySession.AM).expect(409);
      expect(full.body.message).toBe("上午場已額滿（上限 2 人）");
      await register(c.id, CeremonySession.PM).expect(201);
      await register(c.id, CeremonySession.PM).expect(409);
    });

    it("沒選場次或場次不合法：400", async () => {
      const c = await createJigai();
      await register(c.id, undefined).expect(400);
      await submitRegistrations([{ ceremonyId: c.id, walkInName: "甲", amount: 1, session: "NIGHT" }]).expect(400);
    });

    it("收據作廢後號碼釋出，下一位拿到最小的空號", async () => {
      const c = await createJigai();
      const first = await register(c.id, CeremonySession.AM, "甲").expect(201);
      await register(c.id, CeremonySession.AM, "乙").expect(201);

      await api(app, fx.tokens[UserRole.FINANCE])
        .post(`/lantern/receipts/${first.body.receipt.id}/void`, { reason: "報錯場次" })
        .expect(201);

      const next = await register(c.id, CeremonySession.AM, "丙").expect(201);
      expect(next.body.receipt.items[0].note).toBe("丙，上午場 1號");
      const afterThat = await register(c.id, CeremonySession.AM, "丁").expect(201);
      expect(afterThat.body.receipt.items[0].note).toBe("丁，上午場 3號");
    });

    it("整戶報名：每人各拿一個號碼；名額不夠就整批不成立", async () => {
      const token = fx.tokens[UserRole.VOLUNTEER];
      const a = await createMember(app, token, "李大", "李家");
      await createMember(app, token, "李二", "李家");

      const tight = await createJigai(1, 5);
      const rejected = await submitRegistrations([
        { ceremonyId: tight.id, householdId: a.householdId, amount: 600, session: CeremonySession.AM },
      ]).expect(409);
      expect(rejected.body.message).toContain("名額不足");
      const afterReject = (await volunteer.get(`/ceremony/ceremonies/${tight.id}/report`).expect(200)).body;
      expect(afterReject.registrationCount).toBe(0);

      const ok = await submitRegistrations([
        { ceremonyId: tight.id, householdId: a.householdId, amount: 600, session: CeremonySession.PM },
      ]).expect(201);
      expect(ok.body.receipt.items[0]).toMatchObject({ description: "祭改*2人", note: "下午場｜李大 1號、李二 2號" });
      expect(ok.body.receipt.payerName).toBe("李大、李二");
    });

    it("編輯：人數上限不能低於已報名人數，可以調高", async () => {
      const c = await createJigai(3, 3);
      await register(c.id, CeremonySession.AM).expect(201);
      await register(c.id, CeremonySession.AM).expect(201);

      const res = await director.patch(`/ceremony/ceremonies/${c.id}`, { morningCapacity: 1 }).expect(400);
      expect(res.body.message).toContain("上午場已有 2 人報名");
      // 邊界：剛好等於已報名人數可以
      await director.patch(`/ceremony/ceremonies/${c.id}`, { morningCapacity: 2 }).expect(200);
      await register(c.id, CeremonySession.AM).expect(409);
      await director.patch(`/ceremony/ceremonies/${c.id}`, { morningCapacity: 3 }).expect(200);
      await register(c.id, CeremonySession.AM).expect(201);
    });

    it("祭改活動不能認領整桌", async () => {
      const c = await createJigai();
      await submitRegistrations([{ ceremonyId: c.id, walkInName: "甲", amount: 1, tableNumber: 1 }]).expect(400);
    });

    it("同時送出多筆報名也不會撞號（資料庫唯一約束 + 重新取號）", async () => {
      const c = await createJigai(10, 10);
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => register(c.id, CeremonySession.AM, `同時${i}`)),
      );
      const numbers = results
        .filter((r) => r.status === 201)
        .map((r) => r.body.ceremonyRegistration.queueNumber as number);
      expect(new Set(numbers).size).toBe(numbers.length);
      // 沒搶到號的只能是「取號失敗請重送」，不會出現重複號碼或其他錯誤
      for (const r of results.filter((x) => x.status !== 201)) expect(r.status).toBe(409);
      expect(numbers.length).toBeGreaterThan(0);
    });
  });

  // ───────────────────────────── 進香 ─────────────────────────────
  describe("進香（房型、間數、遊覽車台數，不選座位）", () => {
    const rooms = [
      { name: "雙人房", capacity: 2, fee: 3000, roomCount: 2 },
      { name: "四人房", capacity: 4, fee: 5200, roomCount: 1 },
    ];
    const createPilgrimage = (overrides: Record<string, unknown> = {}) =>
      createCeremony({ name: "進香", kind: CeremonyKind.PILGRIMAGE, busCount: 1, roomTypes: rooms, ...overrides });
    const report = async (ceremonyId: string) =>
      (await volunteer.get(`/ceremony/ceremonies/${ceremonyId}/report`).expect(200)).body;
    /** 一筆進香報名：第 1 位是報名者，others 是同行臨櫃參加者姓名 */
    const pilgrim = (ceremonyId: string, roomType: string, amount: number, others: string[] = [], payer = "王小明") => ({
      ceremonyId,
      walkInName: payer,
      roomType,
      amount,
      passengerMemberIds: ["", ...others.map(() => "")],
      passengerNames: ["", ...others],
    });

    it("建立：不使用桌次與座位圖，回傳遊覽車台數、可載人數與每個房型的間數", async () => {
      const c = await createPilgrimage({ busCount: 2, tableCount: 9, seatsPerTable: 9 });
      expect(c).toMatchObject({
        kind: CeremonyKind.PILGRIMAGE,
        totalSeats: null,
        tableCount: null,
        seatsPerTable: null,
        busCount: 2,
        busCapacity: 80,
      });
      expect(c.roomTypes).toEqual(rooms.map((r) => ({ ...r, roomsBooked: 0 })));
      expect(await seatMap(c.id)).toEqual([]);

      // 非進香活動不會存房型與遊覽車台數
      const general = await createCeremony({ roomTypes: rooms, busCount: 3 });
      expect(general).toMatchObject({ roomTypes: null, busCount: null, busCapacity: null });
    });

    it("建立時一定要有遊覽車台數與房型；房型名稱、人數、費用、間數都要合法", async () => {
      const post = (body: Record<string, unknown>) =>
        director.post("/ceremony/ceremonies", {
          templeId: fx.templeId,
          name: "進香",
          date: dateFromToday(30),
          feeMode: CeremonyFeeMode.FREE_WILL,
          kind: CeremonyKind.PILGRIMAGE,
          busCount: 1,
          roomTypes: rooms,
          ...body,
        });
      expect((await post({ busCount: undefined }).expect(400)).body.message).toBe("進香活動請設定遊覽車台數");
      expect((await post({ roomTypes: [] }).expect(400)).body.message).toBe("進香活動請至少設定一種房型");
      await post({ busCount: 0 }).expect(400);
      await post({ roomTypes: [rooms[0], rooms[0]] }).expect(400);
      await post({ roomTypes: [{ ...rooms[0], name: "  " }] }).expect(400);
      await post({ roomTypes: [{ ...rooms[0], capacity: 0 }] }).expect(400);
      await post({ roomTypes: [{ ...rooms[0], fee: -1 }] }).expect(400);
      await post({ roomTypes: [{ ...rooms[0], roomCount: 0 }] }).expect(400);
      await post({ roomTypes: [{ name: "雙人房", capacity: 2, fee: 3000 }] }).expect(400); // 沒填間數
    });

    it("雙人房只住 1 人也可以：金額是整間房費用，收據備註印房型，名單顯示第 1 間", async () => {
      const c = await createPilgrimage();
      const res = await submitRegistrations([pilgrim(c.id, "雙人房", 3000)]).expect(201);
      expect(res.body.receipt).toMatchObject({ amount: 3000, payerName: "王小明" });
      expect(res.body.receipt.items[0]).toMatchObject({ description: "進香", amount: 3000, note: "雙人房" });

      const r = await report(c.id);
      expect(r.registrations).toEqual([
        expect.objectContaining({ participantName: "王小明", roomType: "雙人房", roomNumber: 1, seatNumber: null }),
      ]);
      expect(r.ceremony.roomTypes.find((x: { name: string }) => x.name === "雙人房").roomsBooked).toBe(1);
    });

    it("多位參加者住同一間：信徒記在各自名下、臨櫃用填的姓名，金額只記在報名者身上", async () => {
      const c = await createPilgrimage();
      const token = fx.tokens[UserRole.VOLUNTEER];
      const payer = await createMember(app, token, "王小明");
      const friend = await createMember(app, token, "李大華");

      const res = await submitRegistrations([
        {
          ceremonyId: c.id,
          memberId: payer.id,
          roomType: "四人房",
          amount: 5200,
          passengerMemberIds: ["", friend.id, ""],
          passengerNames: ["", "", "陳小美"],
        },
      ]).expect(201);

      expect(res.body.receipt.items[0]).toMatchObject({
        description: "進香*3人",
        amount: 5200,
        note: "四人房｜王小明、李大華、陳小美",
      });
      expect(res.body.ceremonyRegistrations.map((r: { amount: number }) => r.amount)).toEqual([5200, 0, 0]);

      const r = await report(c.id);
      expect(r).toMatchObject({ registrationCount: 3, totalAmount: 5200 });
      expect(r.registrations.map((x: { roomType: string; roomNumber: number }) => `${x.roomType}${x.roomNumber}`)).toEqual([
        "四人房1",
        "四人房1",
        "四人房1",
      ]);
      // 四人房只有 1 間，住 3 人也算訂掉 1 間
      expect(r.ceremony.roomTypes.find((x: { name: string }) => x.name === "四人房").roomsBooked).toBe(1);

      const history = (await volunteer.get(`/ceremony/members/${friend.id}/history`).expect(200)).body;
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ description: "活動報名（進香）", amount: 0 });
    });

    it("臨櫃同行者沒填姓名：沿用報名者姓名", async () => {
      const c = await createPilgrimage();
      const res = await submitRegistrations([pilgrim(c.id, "雙人房", 3000, [""], "阿土伯")]).expect(201);
      expect(res.body.receipt.items[0].note).toBe("雙人房｜阿土伯、阿土伯");
    });

    it.each([
      ["沒選房型", { roomType: undefined }, "請選擇房型"],
      ["房型不存在", { roomType: "豪華房" }, "請選擇房型"],
      ["金額不是房型費用", { amount: 2999 }, "雙人房費用為 NT$ 3000"],
      ["人數超過每間上限（雙人房 3 人）", { passengerMemberIds: ["", "", ""], passengerNames: ["", "乙", "丙"] }, "雙人房每間最多 2 人，目前登錄 3 人"],
    ])("%s → 400，而且沒有建立任何報名", async (_label, overrides, message) => {
      const c = await createPilgrimage();
      const res = await submitRegistrations([{ ...pilgrim(c.id, "雙人房", 3000, ["乙"]), ...overrides }]).expect(400);
      expect(res.body.message).toBe(message);
      expect((await report(c.id)).registrationCount).toBe(0);
    });

    it("房間依序分配第 1、2 間，訂滿後不能再訂；作廢收據會釋出那一間", async () => {
      const c = await createPilgrimage();
      const first = await submitRegistrations([pilgrim(c.id, "雙人房", 3000, [], "甲")]).expect(201);
      await submitRegistrations([pilgrim(c.id, "雙人房", 3000, ["乙2"], "乙")]).expect(201);

      const full = await submitRegistrations([pilgrim(c.id, "雙人房", 3000, [], "丙")]).expect(409);
      expect(full.body.message).toBe("雙人房已訂滿（共 2 間）");
      // 其他房型不受影響
      await submitRegistrations([pilgrim(c.id, "四人房", 5200, [], "丁")]).expect(201);

      await api(app, fx.tokens[UserRole.FINANCE])
        .post(`/lantern/receipts/${first.body.receipt.id}/void`, { reason: "行程取消" })
        .expect(201);
      await submitRegistrations([pilgrim(c.id, "雙人房", 3000, [], "戊")]).expect(201);

      const r = await report(c.id);
      const roomOf = (name: string) =>
        r.registrations.find((x: { participantName: string }) => x.participantName === name)?.roomNumber;
      expect(roomOf("乙")).toBe(2);
      expect(roomOf("乙2")).toBe(2);
      expect(roomOf("戊")).toBe(1); // 甲作廢後空出來的第 1 間
      expect(r.ceremony.roomTypes.map((x: { name: string; roomsBooked: number }) => [x.name, x.roomsBooked])).toEqual([
        ["雙人房", 2],
        ["四人房", 1],
      ]);
    });

    it("遊覽車坐滿就不能再報名（1 台 = 40 位）", async () => {
      const c = await createPilgrimage({ roomTypes: [{ name: "通鋪", capacity: 40, fee: 0, roomCount: 10 }] });
      const others = (n: number) => Array.from({ length: n }, (_, i) => `乘客${i + 1}`);
      await submitRegistrations([pilgrim(c.id, "通鋪", 0, others(38))]).expect(201); // 39 人

      const over = await submitRegistrations([pilgrim(c.id, "通鋪", 0, ["乙"], "甲")]).expect(409);
      expect(over.body.message).toBe("遊覽車座位不足：1 台共 40 位，已報名 39 位，剩 1 位");
      await submitRegistrations([pilgrim(c.id, "通鋪", 0, [], "甲")]).expect(201);
      await submitRegistrations([pilgrim(c.id, "通鋪", 0, [], "乙")]).expect(409);
      expect((await report(c.id)).registrationCount).toBe(40);
    });

    it("同一位信徒不能重複登錄；信徒不存在 404；信徒 id 格式錯誤 400", async () => {
      const c = await createPilgrimage();
      const m = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "王小明");
      const base = { ceremonyId: c.id, memberId: m.id, roomType: "雙人房", amount: 3000, passengerNames: ["", ""] };

      const dup = await submitRegistrations([{ ...base, passengerMemberIds: ["", m.id] }]).expect(400);
      expect(dup.body.message).toContain("同一位信徒不能重複報名");
      await submitRegistrations([{ ...base, passengerMemberIds: ["", "00000000-0000-4000-8000-000000000000"] }]).expect(404);
      await submitRegistrations([{ ...base, passengerMemberIds: ["", "not-a-uuid"] }]).expect(400);
      expect((await report(c.id)).registrationCount).toBe(0);
    });

    it("進香不能整戶報名、不能認領整桌，也不能走單筆報名 API", async () => {
      const c = await createPilgrimage();
      const a = await createMember(app, fx.tokens[UserRole.VOLUNTEER], "張一", "張家");
      await submitRegistrations([{ ceremonyId: c.id, householdId: a.householdId, amount: 3000, roomType: "雙人房" }]).expect(400);
      await submitRegistrations([{ ...pilgrim(c.id, "雙人房", 3000), tableNumber: 1 }]).expect(400);
      await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount: 3000 }).expect(400);
    });

    it("編輯：可以加台數、加間數、新增房型；不能讓已報名或已訂的房間失效", async () => {
      const c = await createPilgrimage();
      await submitRegistrations([pilgrim(c.id, "雙人房", 3000, ["乙"], "甲")]).expect(201);
      const patch = (body: Record<string, unknown>) => director.patch(`/ceremony/ceremonies/${c.id}`, body);

      const grown = await patch({
        busCount: 3,
        roomTypes: [{ ...rooms[0], roomCount: 5 }, rooms[1], { name: "單人房", capacity: 1, fee: 2000, roomCount: 3 }],
      }).expect(200);
      expect(grown.body).toMatchObject({ busCount: 3, busCapacity: 120 });
      expect(grown.body.roomTypes.map((r: { name: string; roomCount: number; roomsBooked: number }) => [r.name, r.roomCount, r.roomsBooked])).toEqual([
        ["雙人房", 5, 1],
        ["四人房", 1, 0],
        ["單人房", 3, 0],
      ]);

      expect((await patch({ roomTypes: [rooms[1]] }).expect(400)).body.message).toBe("「雙人房」已有人預訂，不能刪除或改名");
      expect((await patch({ roomTypes: [{ ...rooms[0], capacity: 1 }] }).expect(400)).body.message).toBe(
        "「雙人房」已有一間住 2 人，每間人數不可少於此數",
      );
      // 沒人訂的四人房可以刪掉
      await patch({ roomTypes: [rooms[0]] }).expect(200);
    });

    it("編輯：遊覽車台數不能少於已報名人數需要的台數", async () => {
      const c = await createPilgrimage({ busCount: 2, roomTypes: [{ name: "通鋪", capacity: 45, fee: 0, roomCount: 5 }] });
      const others = Array.from({ length: 40 }, (_, i) => `乘客${i + 1}`);
      await submitRegistrations([pilgrim(c.id, "通鋪", 0, others)]).expect(201); // 41 人，要 2 台
      const res = await director.patch(`/ceremony/ceremonies/${c.id}`, { busCount: 1 }).expect(400);
      expect(res.body.message).toBe("已有 41 人報名，遊覽車至少需要 2 台");
    });

    it("編輯：間數不能少於已訂間數", async () => {
      const c = await createPilgrimage();
      await submitRegistrations([pilgrim(c.id, "雙人房", 3000, [], "甲")]).expect(201);
      await submitRegistrations([pilgrim(c.id, "雙人房", 3000, [], "乙")]).expect(201);
      const res = await director
        .patch(`/ceremony/ceremonies/${c.id}`, { roomTypes: [{ ...rooms[0], roomCount: 1 }, rooms[1]] })
        .expect(400);
      expect(res.body.message).toBe("「雙人房」已訂 2 間，間數不可少於此數");
    });

    it("房型全部刪掉後（沒人訂房時）可以不選房型報名，收據列出參加者", async () => {
      const c = await createPilgrimage();
      await director.patch(`/ceremony/ceremonies/${c.id}`, { roomTypes: [] }).expect(200);
      const res = await submitRegistrations([
        { ceremonyId: c.id, walkInName: "甲", amount: 500, passengerMemberIds: ["", ""], passengerNames: ["", "乙"] },
      ]).expect(201);
      expect(res.body.receipt.items[0]).toMatchObject({ description: "進香*2人", note: "參加者｜甲、乙" });
    });

    it("兩個櫃台同時搶最後一間房：只有一個成功", async () => {
      const c = await createPilgrimage();
      const [a, b] = await Promise.all([
        submitRegistrations([pilgrim(c.id, "四人房", 5200, [], "櫃台A")]),
        submitRegistrations([pilgrim(c.id, "四人房", 5200, [], "櫃台B")]),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect((await report(c.id)).registrationCount).toBe(1);
    });

    it("兩個櫃台同時搶最後幾個遊覽車座位：不會超過可載人數", async () => {
      const c = await createPilgrimage({ roomTypes: [{ name: "通鋪", capacity: 45, fee: 0, roomCount: 10 }] });
      const others = Array.from({ length: 37 }, (_, i) => `乘客${i + 1}`);
      await submitRegistrations([pilgrim(c.id, "通鋪", 0, others)]).expect(201); // 38 人，剩 2 位
      const [a, b] = await Promise.all([
        submitRegistrations([pilgrim(c.id, "通鋪", 0, ["A2"], "A")]),
        submitRegistrations([pilgrim(c.id, "通鋪", 0, ["B2"], "B")]),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect((await report(c.id)).registrationCount).toBe(40);
    });
  });

  // ───────────────────────────── 活動報表 ─────────────────────────────
  describe("活動報表", () => {
    it("統計報名筆數與金額，每筆附上收據 id；作廢的不算", async () => {
      const c = await createCeremony();
      const keep = await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "甲", amount: 700 }).expect(201);
      const gone = await volunteer.post("/ceremony/registrations", { ceremonyId: c.id, walkInName: "乙", amount: 300 }).expect(201);
      await api(app, fx.tokens[UserRole.FINANCE])
        .post(`/lantern/receipts/${gone.body.receipt.id}/void`, { reason: "重複報名" })
        .expect(201);

      const report = (await volunteer.get(`/ceremony/ceremonies/${c.id}/report`).expect(200)).body;
      expect(report).toMatchObject({ registrationCount: 1, totalAmount: 700, donationTotal: 0, expenseTotal: 0 });
      expect(report.registrations[0]).toMatchObject({ participantName: "甲", receiptId: keep.body.receipt.id });
    });

    it("報名櫃檯人員（REGISTRAR）不能看活動報表：403", async () => {
      const c = await createCeremony();
      await api(app, fx.tokens[UserRole.REGISTRAR]).get(`/ceremony/ceremonies/${c.id}/report`).expect(403);
    });
  });
});
