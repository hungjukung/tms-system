import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { DonationType, Gender, LedgerEntryStatus, LedgerEntryType, MemberTagType, ReceiptSourceType, ReceiptStatus, UserRole } from "@tms/shared";
import { FinanceService } from "../../src/finance/finance.service";
import { HouseholdService } from "../../src/household/household.service";
import { LunarService } from "../../src/household/lunar.service";
import { MemberAdminService } from "../../src/household/member-admin.service";
import { LanternService } from "../../src/lantern/lantern.service";
import { mockRepo, MockRepo, otherDbError, uniqueViolation } from "./support/mocks";

/** 白箱單元測試：戶籍（匯入解析、戶長計算）、財務（零用金、審核、報表加總）、點燈與收據的內部邏輯 */

describe("HouseholdService（白箱）", () => {
  let householdRepo: MockRepo;
  let memberRepo: MockRepo;
  let service: HouseholdService;
  let internals: any;

  beforeEach(() => {
    householdRepo = mockRepo();
    memberRepo = mockRepo();
    service = new HouseholdService(householdRepo as never, memberRepo as never, new LunarService());
    internals = service;
  });

  describe("parseImportBirthDate：匯入檔的生日欄位", () => {
    it.each([
      ["1990-05-15", "1990-05-15"],
      ["1990/5/5", "1990-05-05"],
      ["79/5/15", "1990-05-15"], // 民國 79 年
      ["079-05-15", "1990-05-15"],
      ["1/1/1", "1912-01-01"], // 民國元年
      ["  80/1/2 吉  ", "1991-01-02"], // 前後空白與後面的註記都忽略
      ["2020/2/29", "2020-02-29"], // 閏年
    ])("%s → %s", (raw, expected) => {
      expect(internals.parseImportBirthDate(raw)).toBe(expected);
    });

    it.each([
      ["空字串", ""],
      ["只有空白", "   "],
      ["沒給", undefined],
      ["純文字", "不知道"],
      ["沒有分隔符號", "19900515"],
      ["月份 0", "1990/0/1"],
      ["月份 13", "1990/13/1"],
      ["日 0", "1990/1/0"],
      ["日 32", "1990/1/32"],
      ["非閏年的 2/29", "2018/2/29"],
      ["4 月 31 日", "1990/4/31"],
      ["民國年的非閏年 2/29（民國 107 年 = 2018）", "107/2/29"],
    ])("%s → null（跳過這個欄位，不擋整筆資料）", (_label, raw) => {
      expect(internals.parseImportBirthDate(raw)).toBeNull();
    });
  });

  it("isRealCalendarDate：不會被 JS Date 自動進位騙過", () => {
    expect(internals.isRealCalendarDate(2020, 2, 29)).toBe(true);
    expect(internals.isRealCalendarDate(2018, 2, 29)).toBe(false);
    expect(internals.isRealCalendarDate(2026, 12, 31)).toBe(true);
    expect(internals.isRealCalendarDate(2026, 11, 31)).toBe(false);
  });

  it("parseGender：中英文、大小寫、前後空白都認得；認不得就是 UNKNOWN", () => {
    for (const v of ["男", "male", "MALE", " m "]) expect(internals.parseGender(v)).toBe(Gender.MALE);
    for (const v of ["女", "Female", "f"]) expect(internals.parseGender(v)).toBe(Gender.FEMALE);
    for (const v of ["", undefined, "其他", "X"]) expect(internals.parseGender(v)).toBe(Gender.UNKNOWN);
  });

  it("parseTags：逗號、頓號、空白都能分隔；中文標籤與代碼都認得；認不得的丟掉", () => {
    expect(internals.parseTags(undefined)).toEqual([]);
    expect(internals.parseTags("")).toEqual([]);
    expect(internals.parseTags("一般信徒,合法信徒")).toEqual([MemberTagType.GENERAL, MemberTagType.LEGAL_MEMBER]);
    expect(internals.parseTags("合法信徒、一般信徒")).toEqual([MemberTagType.LEGAL_MEMBER, MemberTagType.GENERAL]);
    expect(internals.parseTags("一般信徒，  合法信徒  ")).toEqual([MemberTagType.GENERAL, MemberTagType.LEGAL_MEMBER]);
    expect(internals.parseTags("LEGAL_MEMBER VIP 貴賓")).toEqual([MemberTagType.LEGAL_MEMBER]);
  });

  describe("recomputeHouseholdHead：戶長計算", () => {
    const run = async (household: object | null, members: object[]) => {
      householdRepo.findOne.mockResolvedValue(household);
      memberRepo.find.mockResolvedValue(members);
      await internals.recomputeHouseholdHead("h1");
      return householdRepo.save.mock.calls[0]?.[0] as { headMemberId: string | null } | undefined;
    };
    const m = (id: string, birthDateSolar: string | null, createdAt = "2026-01-01") => ({ id, birthDateSolar, createdAt: new Date(createdAt) });

    it("戶籍不存在：什麼都不做", async () => {
      expect(await run(null, [])).toBeUndefined();
      expect(memberRepo.find).not.toHaveBeenCalled();
    });

    it("戶內沒人：把戶長清空；本來就沒有戶長就不存檔", async () => {
      expect(await run({ id: "h1", headMemberId: "old" }, [])).toMatchObject({ headMemberId: null });
      householdRepo.save.mockClear();
      expect(await run({ id: "h1", headMemberId: null }, [])).toBeUndefined();
    });

    it("有人填生日：生日最早的人當戶長（沒填生日的人不參與比較）", async () => {
      const saved = await run({ id: "h1", headMemberId: null }, [m("young", "2000-01-01"), m("noBirthday", null, "2020-01-01"), m("old", "1950-06-01")]);
      expect(saved).toMatchObject({ headMemberId: "old" });
    });

    it("都沒填生日：原戶長還在就維持；原戶長不在就由最早建檔的人暫代", async () => {
      expect(await run({ id: "h1", headMemberId: "b" }, [m("a", null, "2026-01-01"), m("b", null, "2026-02-01")])).toBeUndefined();
      expect(await run({ id: "h1", headMemberId: "gone" }, [m("late", null, "2026-03-01"), m("early", null, "2026-01-01")])).toMatchObject({
        headMemberId: "early",
      });
    });

    it("戶長沒變：不多存一次", async () => {
      expect(await run({ id: "h1", headMemberId: "old" }, [m("old", "1950-01-01"), m("young", "2000-01-01")])).toBeUndefined();
    });
  });

  describe("importMembers", () => {
    beforeEach(() => {
      // 交易內用的 repository 就是同一組 mock
      memberRepo.txManager.getRepository.mockImplementation((entity: { name: string }) => (entity.name === "Household" ? householdRepo : memberRepo));
    });

    it("地址已有戶籍就歸入，不重複建立；信徒地址沒填時沿用戶籍地址", async () => {
      householdRepo.findOne.mockResolvedValue({ id: "existing", address: "中埔1號", headMemberId: null });
      const result = await service.importMembers([{ householdAddress: " 中埔1號 ", name: " 王小明 ", phone: " ", tags: "合法信徒" }]);
      expect(result).toEqual({ successCount: 1, failedRows: [] });
      expect(householdRepo.create).not.toHaveBeenCalled();
      expect(memberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ householdId: "existing", name: "王小明", phone: null, address: "中埔1號", gender: Gender.UNKNOWN, tags: [MemberTagType.LEGAL_MEMBER] }),
      );
    });

    it("同一批裡地址相同的列只建一次戶籍；地址空白的列不查既有戶籍、各自建立", async () => {
      await service.importMembers([
        { householdAddress: "A", name: "甲", householdPhone: " 05-1 " },
        { householdAddress: "A", name: "乙" },
        { name: "丙" },
        { name: "丁" },
      ]);
      expect(householdRepo.create.mock.calls.map(([h]: any) => [h.address, h.phone])).toEqual([
        ["A", "05-1"],
        ["", null],
        ["", null],
      ]);
    });

    it("有另外填信徒地址就用信徒地址；生日換算出農曆與生肖", async () => {
      await service.importMembers([{ householdAddress: "戶籍地", address: "通訊地", name: "甲", birthDateSolar: "79/5/15", gender: "男" }]);
      expect(memberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ address: "通訊地", birthDateSolar: "1990-05-15", zodiac: "馬", birthDateLunar: "庚午年 四月廿一", gender: Gender.MALE }),
      );
    });

    it("資料庫出錯：整批回滾，回報失敗原因，不會拋出例外讓前端整個壞掉", async () => {
      memberRepo.save.mockRejectedValue(new Error("連線中斷"));
      expect(await service.importMembers([{ name: "甲" }])).toEqual({
        successCount: 0,
        failedRows: [{ rowNumber: 0, name: "", message: "匯入失敗，未寫入任何資料：連線中斷" }],
      });
      memberRepo.manager.transaction.mockRejectedValue("奇怪的錯誤");
      expect((await service.importMembers([{ name: "甲" }])).failedRows[0].message).toBe("匯入失敗，未寫入任何資料：未知錯誤");
    });
  });

  describe("其他分支", () => {
    it("刪除戶籍：找不到 404；還有信徒 409；空戶才刪", async () => {
      await expect(service.deleteHousehold("x")).rejects.toThrow(NotFoundException);
      householdRepo.findOne.mockResolvedValue({ id: "h1" });
      memberRepo.count.mockResolvedValue(2);
      await expect(service.deleteHousehold("h1")).rejects.toThrow("此戶籍下還有 2 位信徒");
      memberRepo.count.mockResolvedValue(0);
      await service.deleteHousehold("h1");
      expect(householdRepo.remove).toHaveBeenCalled();
    });

    it("更新戶籍：電話送空字串存成 null；沒送的欄位不動", async () => {
      await expect(service.updateHousehold("x", {})).rejects.toThrow("找不到戶籍資料");
      householdRepo.findOne.mockImplementation(async () => ({ id: "h1", address: "舊", phone: "05", headMemberId: null, createdAt: new Date() }));
      expect(await service.updateHousehold("h1", { phone: "" })).toMatchObject({ address: "舊", phone: null });
      expect(await service.updateHousehold("h1", { address: "新" })).toMatchObject({ address: "新", phone: "05" });
    });

    it("查信徒地址：信徒自己的地址優先，沒有才用戶籍地址；信徒不存在回傳 null", async () => {
      expect(await service.findHouseholdAddressByMemberId("x")).toBeNull();
      memberRepo.findOne.mockResolvedValue({ id: "m1", address: "自己的地址", householdId: "h1" });
      expect(await service.findHouseholdAddressByMemberId("m1")).toBe("自己的地址");
      memberRepo.findOne.mockResolvedValue({ id: "m1", address: null, householdId: "h1" });
      householdRepo.findOne.mockResolvedValue({ address: "戶籍地址" });
      expect(await service.findHouseholdAddressByMemberId("m1")).toBe("戶籍地址");
      householdRepo.findOne.mockResolvedValue(null);
      expect(await service.findHouseholdAddressByMemberId("m1")).toBeNull();
    });

    it("findMembersByIds：空陣列不查資料庫；findMemberByIdOrNull 找不到回傳 null 不拋錯", async () => {
      expect((await service.findMembersByIds([])).size).toBe(0);
      expect(memberRepo.find).not.toHaveBeenCalled();
      expect(await service.findMemberByIdOrNull("x")).toBeNull();
      await expect(service.findMemberById("x")).rejects.toThrow("找不到信徒資料");
      await expect(service.deleteMemberRow("x")).rejects.toThrow("找不到信徒資料");
    });

    it("搜尋戶籍：地址與成員姓名的結果合併去重、新的排前面、再分頁", async () => {
      const h = (id: string, day: number) => ({ id, address: id, phone: null, headMemberId: null, createdAt: new Date(2026, 0, day) });
      householdRepo.find.mockResolvedValueOnce([h("a", 1), h("b", 3)]).mockResolvedValueOnce([h("b", 3), h("c", 2)]);
      memberRepo.find.mockResolvedValue([{ householdId: "b" }, { householdId: "c" }]);
      const result = await service.searchHouseholds("關鍵字", 1, 2);
      expect(result.total).toBe(3);
      expect(result.items.map((i) => i.id)).toEqual(["b", "c"]);
    });

    it("信徒資料的犯太歲標記：有生肖才判斷", async () => {
      const row = (zodiac: string | null) => ({ id: "m1", householdId: "h1", name: "甲", zodiac, tags: [], createdAt: new Date() });
      memberRepo.findOne.mockResolvedValue(row(null));
      expect((await service.findMemberById("m1")).isZodiacClashYear).toBe(false);
      const thisYearZodiac = new LunarService().getZodiacOfYear(new Date().getFullYear());
      memberRepo.findOne.mockResolvedValue(row(thisYearZodiac));
      expect((await service.findMemberById("m1")).isZodiacClashYear).toBe(true);
    });
  });
});

describe("MemberAdminService（白箱）", () => {
  const build = (lanternHistory: object[], ceremonyHistory: object[]) => {
    const household = { findMemberById: jest.fn().mockResolvedValue({}), deleteMemberRow: jest.fn() };
    const service = new MemberAdminService(
      household as never,
      { findHistoryByMemberId: jest.fn().mockResolvedValue(lanternHistory) } as never,
      { findHistoryByMemberId: jest.fn().mockResolvedValue(ceremonyHistory) } as never,
    );
    return { service, household };
  };

  it("沒有任何紀錄：直接刪", async () => {
    const { service, household } = build([], []);
    await service.deleteMember("m1");
    expect(household.deleteMemberRow).toHaveBeenCalledWith("m1");
  });

  it("點燈／捐款與活動紀錄合計筆數；沒有 force 就 409，有 force 才刪", async () => {
    const { service, household } = build([{}, {}], [{}]);
    await expect(service.deleteMember("m1")).rejects.toMatchObject({ response: { historyCount: 3 } });
    expect(household.deleteMemberRow).not.toHaveBeenCalled();
    await service.deleteMember("m1", true);
    expect(household.deleteMemberRow).toHaveBeenCalled();
  });
});

describe("FinanceService（白箱）", () => {
  let ledgerRepo: MockRepo;
  let auditLogRepo: MockRepo;
  let userRepo: MockRepo;
  let templeRepo: MockRepo;
  let lantern: Record<string, jest.Mock>;
  let service: FinanceService;

  const entry = (overrides: object = {}) => ({
    id: "e1",
    templeId: "t1",
    type: LedgerEntryType.EXPENSE,
    category: "水電",
    amount: "100.00",
    description: null,
    occurredAt: "2026-05-17",
    status: LedgerEntryStatus.PENDING,
    isPettyCash: false,
    ceremonyId: null,
    createdByUserId: "u1",
    reviewedByUserId: null,
    reviewedReason: null,
    createdAt: new Date("2026-05-17T00:00:00Z"),
    ...overrides,
  });

  beforeEach(() => {
    ledgerRepo = mockRepo();
    auditLogRepo = mockRepo();
    userRepo = mockRepo();
    templeRepo = mockRepo();
    lantern = {
      getIssuedIncomeReport: jest.fn().mockResolvedValue({ byCategory: [], details: [] }),
      getIssuedReceiptDates: jest.fn().mockResolvedValue([]),
    };
    service = new FinanceService(ledgerRepo as never, auditLogRepo as never, userRepo as never, templeRepo as never, lantern as never);
  });

  describe("getPettyCashBalance", () => {
    it("餘額 = 撥補總額 − 從零用金支出的總額", async () => {
      ledgerRepo.find
        .mockResolvedValueOnce([entry({ amount: "5000.00" }), entry({ amount: "1000.00" })])
        .mockResolvedValueOnce([entry({ amount: "300.50" })]);
      expect(await service.getPettyCashBalance()).toBe(5699.5);
    });

    it("沒指定廟宇：不查歸零基準點，也不加廟宇與時間條件", async () => {
      await service.getPettyCashBalance();
      expect(templeRepo.findOne).not.toHaveBeenCalled();
      const where = ledgerRepo.find.mock.calls[0][0].where;
      expect(where.templeId).toBeUndefined();
      expect(where.createdAt).toBeUndefined();
    });

    it("廟宇有歸零基準點：只算基準點之後的項目；沒有基準點或廟宇不存在就不加時間條件", async () => {
      templeRepo.findOne.mockResolvedValue({ pettyCashResetAt: new Date("2026-05-01T00:00:00Z") });
      await service.getPettyCashBalance("t1");
      expect(ledgerRepo.find.mock.calls[0][0].where).toMatchObject({ templeId: "t1" });
      expect(ledgerRepo.find.mock.calls[0][0].where.createdAt).toBeDefined();

      ledgerRepo.find.mockClear();
      templeRepo.findOne.mockResolvedValue({ pettyCashResetAt: null });
      await service.getPettyCashBalance("t1");
      expect(ledgerRepo.find.mock.calls[0][0].where.createdAt).toBeUndefined();

      ledgerRepo.find.mockClear();
      templeRepo.findOne.mockResolvedValue(null);
      await service.getPettyCashBalance("t1");
      expect(ledgerRepo.find.mock.calls[0][0].where.createdAt).toBeUndefined();
    });

    it("歸零：廟宇不存在（沒有更新到資料列）404", async () => {
      templeRepo.qb.execute.mockResolvedValue({ affected: 0 });
      await expect(service.resetPettyCashBalance("x")).rejects.toThrow("找不到廟宇");
      templeRepo.qb.execute.mockResolvedValue({ affected: 1 });
      expect(await service.resetPettyCashBalance("t1")).toEqual({ balance: 0 });
    });
  });

  describe("reviewEntry", () => {
    it("找不到 404；已審核過 409；駁回沒寫原因 400", async () => {
      await expect(service.reviewEntry("x", { action: "APPROVE" }, "u2")).rejects.toThrow(NotFoundException);
      ledgerRepo.findOne.mockResolvedValue(entry({ status: LedgerEntryStatus.APPROVED }));
      await expect(service.reviewEntry("e1", { action: "APPROVE" }, "u2")).rejects.toThrow(new ConflictException("此項目已經審核過了"));
      ledgerRepo.findOne.mockResolvedValue(entry());
      await expect(service.reviewEntry("e1", { action: "REJECT" }, "u2")).rejects.toThrow(new BadRequestException("駁回時必須填寫原因"));
      await expect(service.reviewEntry("e1", { action: "REJECT", reason: "" }, "u2")).rejects.toThrow(BadRequestException);
    });

    it("核准／駁回：記下審核人與原因", async () => {
      ledgerRepo.findOne.mockImplementation(async () => entry());
      userRepo.find.mockResolvedValue([{ id: "u1", displayName: "建立者" }, { id: "u2", displayName: "審核者" }]);
      expect(await service.reviewEntry("e1", { action: "APPROVE" }, "u2")).toMatchObject({
        status: LedgerEntryStatus.APPROVED,
        reviewedByName: "審核者",
        reviewedReason: null,
        createdByName: "建立者",
      });
      expect(await service.reviewEntry("e1", { action: "REJECT", reason: "沒單據" }, "u2")).toMatchObject({
        status: LedgerEntryStatus.REJECTED,
        reviewedReason: "沒單據",
      });
    });
  });

  it("batchApprove：空陣列直接回 0 不查資料庫；只核准查到的待審核項目", async () => {
    expect(await service.batchApprove([], "u2")).toEqual({ approvedCount: 0 });
    expect(ledgerRepo.find).not.toHaveBeenCalled();
    ledgerRepo.find.mockResolvedValue([entry({ id: "a" }), entry({ id: "b" })]);
    expect(await service.batchApprove(["a", "b", "already-approved"], "u2")).toEqual({ approvedCount: 2 });
    const saved = ledgerRepo.save.mock.calls[0][0] as { status: string; reviewedByUserId: string }[];
    expect(saved.every((e) => e.status === LedgerEntryStatus.APPROVED && e.reviewedByUserId === "u2")).toBe(true);
  });

  it("confirmAudit：沒指定廟宇 400；重複的日期只處理一次；已標記過的日期更新審核人", async () => {
    await expect(service.confirmAudit("", ["2026-05-17"], "u2")).rejects.toThrow(BadRequestException);
    auditLogRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ templeId: "t1", date: "2026-05-18", auditedByUserId: "old" });
    const result = await service.confirmAudit("t1", ["2026-05-17", "2026-05-17", "2026-05-18"], "u2");
    expect(result).toEqual({ auditedDates: ["2026-05-17", "2026-05-18"] });
    expect(auditLogRepo.create).toHaveBeenCalledTimes(1);
    expect(auditLogRepo.save.mock.calls[1][0]).toMatchObject({ date: "2026-05-18", auditedByUserId: "u2" });
  });

  it("getAuditCalendar：沒指定廟宇 400；同一天的各種狀態、收據收入、已審核標記合併成一列", async () => {
    await expect(service.getAuditCalendar("2026-05-01", "2026-05-31", "")).rejects.toThrow("請先選擇一間廟宇才能查看審核日誌");
    ledgerRepo.qb.getRawMany.mockResolvedValue([
      { date: "2026-05-17", status: LedgerEntryStatus.PENDING, count: "2" },
      { date: "2026-05-17", status: LedgerEntryStatus.APPROVED, count: "1" },
      { date: "2026-05-18", status: LedgerEntryStatus.REJECTED, count: "3" },
      { date: "2026-05-18", status: "UNKNOWN", count: "9" },
    ]);
    lantern.getIssuedReceiptDates.mockResolvedValue(["2026-05-17", "2026-05-20"]);
    auditLogRepo.find.mockResolvedValue([{ date: "2026-05-18" }]);
    expect(await service.getAuditCalendar("2026-05-01", "2026-05-31", "t1")).toEqual([
      { date: "2026-05-17", pendingCount: 2, approvedCount: 1, rejectedCount: 0, hasReceiptIncome: true, audited: false },
      { date: "2026-05-18", pendingCount: 0, approvedCount: 0, rejectedCount: 3, hasReceiptIncome: false, audited: true },
      { date: "2026-05-20", pendingCount: 0, approvedCount: 0, rejectedCount: 0, hasReceiptIncome: true, audited: false },
    ]);
    // 結束日當天整天都要算進去：查收據的結束時間是隔天 00:00
    const [start, end] = lantern.getIssuedReceiptDates.mock.calls[0];
    expect([start.getDate(), end.getMonth(), end.getDate()]).toEqual([1, 5, 1]);
  });

  describe("報表", () => {
    it("加總規則：收據收入 + 流水帳收入 − 一般支出；從零用金支出的不算進總支出，另外列出並依日期排序", async () => {
      lantern.getIssuedIncomeReport.mockResolvedValue({
        byCategory: [{ label: "一般捐款", amount: 1000 }, { label: "點燈", amount: 600 }],
        details: [{}, {}],
      });
      ledgerRepo.qb.getMany.mockResolvedValue([
        entry({ type: LedgerEntryType.INCOME, category: "金紙販售", amount: "200.00" }),
        entry({ type: LedgerEntryType.INCOME, category: "金紙販售", amount: "50.00" }),
        entry({ category: "水電", amount: "150.00" }),
        entry({ category: "修繕", amount: "100.00" }),
        entry({ id: "p2", category: "文具", amount: "30.00", isPettyCash: true, occurredAt: "2026-05-20" }),
        entry({ id: "p1", category: "餐費", amount: "20.00", isPettyCash: true, occurredAt: "2026-05-10" }),
      ]);
      ledgerRepo.count.mockResolvedValue(4);

      const report = await service.getDailyReport("2026-05-17", "t1");
      expect(report).toMatchObject({
        periodLabel: "2026-05-17",
        lanternAndDonationIncome: 1600,
        ledgerIncome: 250,
        totalIncome: 1850,
        totalExpense: 250,
        netAmount: 1600,
        pendingEntryCount: 4,
        pettyCashExpenseTotal: 50,
      });
      expect(report.ledgerIncomeByCategory).toEqual([{ category: "金紙販售", amount: 250 }]);
      expect(report.expenseByCategory).toEqual([{ category: "水電", amount: 150 }, { category: "修繕", amount: 100 }]);
      expect(report.pettyCashExpenseDetails.map((e) => e.id)).toEqual(["p1", "p2"]);
      expect(ledgerRepo.qb.andWhere).toHaveBeenCalledWith("entry.templeId = :templeId", { templeId: "t1" });
    });

    it("每日／月／區間／年度的期間標籤與起訖時間", async () => {
      const range = () => lantern.getIssuedIncomeReport.mock.calls.at(-1)!.slice(0, 2).map((d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()]);

      expect((await service.getDailyReport("2026-12-31")).periodLabel).toBe("2026-12-31");
      expect(range()).toEqual([[2026, 12, 31], [2027, 1, 1]]);

      expect((await service.getMonthlyReport(2024, 2)).periodLabel).toBe("2024-02");
      expect(range()).toEqual([[2024, 2, 1], [2024, 3, 1]]);
      // 流水帳的日期條件：閏年 2 月到 29 日
      expect(ledgerRepo.qb.where).toHaveBeenLastCalledWith(expect.any(String), { from: "2024-02-01", to: "2024-02-29" });

      expect((await service.getMonthlyReport(2026, 12)).periodLabel).toBe("2026-12");
      expect(range()).toEqual([[2026, 12, 1], [2027, 1, 1]]);

      expect((await service.getRangeReport("2026-01-30", "2026-01-31")).periodLabel).toBe("2026-01-30 ~ 2026-01-31");
      expect(range()).toEqual([[2026, 1, 30], [2026, 2, 1]]);

      expect((await service.getAnnualReport(2026)).periodLabel).toBe("2026");
      expect(range()).toEqual([[2026, 1, 1], [2027, 1, 1]]);
      expect(ledgerRepo.qb.where).toHaveBeenLastCalledWith(expect.any(String), { from: "2026-01-01", to: "2026-12-31" });
      // 沒指定廟宇時不加廟宇條件
      expect(ledgerRepo.qb.andWhere).not.toHaveBeenCalledWith("entry.templeId = :templeId", expect.anything());
    });
  });

  it("listEntries：有給的條件才加；起訖日期要兩個都給才篩選", async () => {
    await service.listEntries();
    expect(ledgerRepo.find.mock.calls[0][0].where).toEqual({});
    await service.listEntries(LedgerEntryStatus.PENDING, "t1", "2026-01-01");
    expect(ledgerRepo.find.mock.calls[1][0].where).toEqual({ status: LedgerEntryStatus.PENDING, templeId: "t1" });
    await service.listEntries(undefined, undefined, "2026-01-01", "2026-01-31");
    expect(Object.keys(ledgerRepo.find.mock.calls[2][0].where)).toEqual(["occurredAt"]);
  });

  it("createEntry：金額存兩位小數，狀態一律從待審核開始，選填欄位有預設值", async () => {
    await service.createEntry({ templeId: "t1", type: LedgerEntryType.EXPENSE, category: "水電", amount: 99.5, occurredAt: "2026-05-17" }, "u1");
    expect(ledgerRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "99.50", status: LedgerEntryStatus.PENDING, isPettyCash: false, ceremonyId: null, description: null }),
    );
  });
});

describe("LanternService（白箱）", () => {
  let repos: Record<string, MockRepo>;
  let household: Record<string, jest.Mock>;
  let gateway: { broadcastSlotClaimed: jest.Mock };
  let service: LanternService;
  let internals: any;

  beforeEach(() => {
    repos = Object.fromEntries(
      ["wall", "slot", "claim", "donation", "receipt", "auditLog", "user", "ceremony", "registration", "gift"].map((k) => [k, mockRepo()]),
    );
    household = {
      findMemberById: jest.fn().mockResolvedValue({ id: "m1", name: "王小明" }),
      findMemberByIdOrNull: jest.fn().mockResolvedValue({ id: "m1", name: "王小明" }),
      findMembersByIds: jest.fn().mockResolvedValue(new Map()),
      findMembersByHouseholdId: jest.fn().mockResolvedValue([]),
    };
    gateway = { broadcastSlotClaimed: jest.fn() };
    service = new LanternService(
      repos.wall as never,
      repos.slot as never,
      repos.claim as never,
      repos.donation as never,
      repos.receipt as never,
      repos.auditLog as never,
      repos.user as never,
      repos.ceremony as never,
      repos.registration as never,
      repos.gift as never,
      household as never,
      gateway as never,
    );
    internals = service;
  });

  it("generateReceiptNo：R + 8 碼日期 + 6 碼數字（100000～999999）", () => {
    for (const random of [0, 0.5, 0.999999]) {
      jest.spyOn(Math, "random").mockReturnValue(random);
      expect(internals.generateReceiptNo()).toMatch(/^R\d{8}[1-9]\d{5}$/);
    }
    jest.spyOn(Math, "random").mockReturnValue(0);
    expect(internals.generateReceiptNo().slice(-6)).toBe("100000");
    jest.spyOn(Math, "random").mockReturnValue(0.9999999);
    expect(internals.generateReceiptNo().slice(-6)).toBe("999999");
    jest.restoreAllMocks();
  });

  it("categorizeCombinedItemLabel：活動報名看 category 標記、點燈看文字開頭、其餘用原本的說明", () => {
    expect(internals.categorizeCombinedItemLabel({ description: "法會", amount: 1, category: "CEREMONY_REGISTRATION" })).toBe("活動報名");
    expect(internals.categorizeCombinedItemLabel({ description: "點燈*3人", amount: 1 })).toBe("點燈");
    expect(internals.categorizeCombinedItemLabel({ description: "一般捐款", amount: 1 })).toBe("一般捐款");
    expect(internals.categorizeCombinedItemLabel({ description: "右牆", amount: 1 })).toBe("右牆");
  });

  it("getSourceRefs：合併收據展開每個項目的來源；單筆收據用自己的來源；沒有來源就是空陣列", () => {
    const ref = (id: string) => ({ sourceType: ReceiptSourceType.LANTERN_CLAIM, sourceId: id });
    expect(
      internals.getSourceRefs({ sourceType: ReceiptSourceType.COMBINED, items: [{ sourceRefs: [ref("a"), ref("b")] }, {}, { sourceRefs: [ref("c")] }] }),
    ).toEqual([ref("a"), ref("b"), ref("c")]);
    expect(internals.getSourceRefs({ sourceType: ReceiptSourceType.COMBINED, items: null })).toEqual([]);
    expect(internals.getSourceRefs({ sourceType: ReceiptSourceType.DONATION, sourceId: "d1" })).toEqual([{ sourceType: ReceiptSourceType.DONATION, sourceId: "d1" }]);
    expect(internals.getSourceRefs({ sourceType: ReceiptSourceType.DONATION, sourceId: null })).toEqual([]);
  });

  describe("generateSlots：燈位代碼命名", () => {
    const pos = (row: number, column: number) => ({ row, column, gridRow: row, gridColumn: column });

    it("找不到燈牆 404", async () => {
      await expect(service.generateSlots("x", { prefix: "A", positions: [pos(1, 1)] })).rejects.toThrow("找不到燈牆");
    });

    it("全部在同一排：A-01；跨多排：A1-01；格號補到兩位數、超過兩位數不截斷", async () => {
      repos.wall.findOne.mockResolvedValue({ id: "w1" });
      await service.generateSlots("w1", { prefix: "A", positions: [pos(3, 1), pos(3, 12), pos(3, 100)] });
      expect(repos.slot.create.mock.calls.map(([s]: any) => s.code)).toEqual(["A-01", "A-12", "A-100"]);

      repos.slot.create.mockClear();
      await service.generateSlots("w1", { prefix: "右", positions: [pos(1, 1), pos(2, 1)] });
      expect(repos.slot.create.mock.calls.map(([s]: any) => s.code)).toEqual(["右1-01", "右2-01"]);
    });

    it("代碼重複 409；其他錯誤原樣往外丟", async () => {
      repos.wall.findOne.mockResolvedValue({ id: "w1" });
      repos.slot.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.generateSlots("w1", { prefix: "A", positions: [pos(1, 1)] })).rejects.toThrow(ConflictException);
      const dbError = otherDbError();
      repos.slot.save.mockRejectedValueOnce(dbError);
      await expect(service.generateSlots("w1", { prefix: "A", positions: [pos(1, 1)] })).rejects.toBe(dbError);
    });
  });

  describe("捐款", () => {
    const dto = (overrides: object = {}) => ({ templeId: "t1", walkInName: "捐款人", type: DonationType.GENERAL, amount: 100, ...overrides });

    it("沒有信徒也沒有姓名（或只有空白）：400，不建立捐款紀錄", async () => {
      for (const walkInName of [undefined, "", "  "]) {
        await expect(
          service.createDonationForCombined(dto({ walkInName }) as never, "u1", UserRole.VOLUNTEER),
        ).rejects.toThrow("請選擇信徒或填寫捐款人姓名");
      }
      expect(repos.donation.save).not.toHaveBeenCalled();
    });

    it.each([UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.REGISTRAR])("%s 填自訂項目或數量：403", async (role) => {
      await expect(service.createDonationForCombined(dto({ customItem: "金牌" }) as never, "u1", role)).rejects.toThrow(
        new ForbiddenException("只有總幹事可以自訂捐款項目與數量"),
      );
      await expect(service.createDonationForCombined(dto({ quantity: 1 }) as never, "u1", role)).rejects.toThrow(ForbiddenException);
      expect(repos.donation.save).not.toHaveBeenCalled();
    });

    it("指定的活動不存在：404；指定活動時類型一律改成活動捐款", async () => {
      await expect(service.createDonationForCombined(dto({ ceremonyId: "c1" }) as never, "u1", UserRole.VOLUNTEER)).rejects.toThrow("找不到活動");
      repos.ceremony.findOne.mockResolvedValue({ id: "c1", name: "建醮" });
      await service.createDonationForCombined(dto({ ceremonyId: "c1", type: DonationType.PUDU }) as never, "u1", UserRole.VOLUNTEER);
      expect(repos.donation.create).toHaveBeenCalledWith(expect.objectContaining({ type: DonationType.CEREMONY, ceremonyId: "c1" }));
    });
  });

  describe("describeLanternSource：收據上的姓名、項目與備註", () => {
    it("捐款：信徒姓名優先；自訂項目印在備註（有數量才加 x數量）；指定活動時項目是「活動名稱 捐款」", async () => {
      repos.donation.findOne.mockResolvedValue({ type: DonationType.PUDU, walkInName: "臨櫃", memberId: null, customItem: null });
      expect(await service.describeLanternSource(ReceiptSourceType.DONATION, "d1")).toEqual({ payerName: "臨櫃", description: "普渡捐款", note: undefined });

      repos.donation.findOne.mockResolvedValue({ type: DonationType.GENERAL, walkInName: "臨櫃", memberId: "m1", customItem: "金牌", quantity: 2 });
      expect(await service.describeLanternSource(ReceiptSourceType.DONATION, "d1")).toEqual({ payerName: "王小明", description: "一般捐款", note: "項目：金牌 x2" });

      repos.donation.findOne.mockResolvedValue({ type: DonationType.GENERAL, customItem: "金牌", quantity: null, ceremonyId: "c1" });
      repos.ceremony.findOne.mockResolvedValue({ name: "建醮" });
      expect(await service.describeLanternSource(ReceiptSourceType.DONATION, "d1")).toMatchObject({ description: "建醮 捐款", note: "項目：金牌" });

      // 活動已被刪除：退回用捐款類型的名稱
      repos.ceremony.findOne.mockResolvedValue(null);
      expect((await service.describeLanternSource(ReceiptSourceType.DONATION, "d1")).description).toBe("一般捐款");
    });

    it("捐款紀錄已被刪除：姓名空白、項目用預設的「油香捐款」", async () => {
      expect(await service.describeLanternSource(ReceiptSourceType.DONATION, "gone")).toEqual({ payerName: "", description: "油香捐款", note: undefined });
    });

    it("點燈：項目優先用點燈內容、其次燈牆名稱；備註是「燈位：代碼」", async () => {
      repos.claim.findOne.mockResolvedValue({ slotId: "s1", memberId: null, walkInName: "龔忠欣", lanternType: null });
      repos.slot.findOne.mockResolvedValue({ id: "s1", wallId: "w1", code: "右1-01" });
      repos.wall.findOne.mockResolvedValue({ name: "右牆" });
      expect(await service.describeLanternSource(ReceiptSourceType.LANTERN_CLAIM, "c1")).toEqual({
        payerName: "龔忠欣",
        description: "右牆",
        note: "燈位：右1-01",
      });

      repos.claim.findOne.mockResolvedValue({ slotId: "s1", memberId: "m1", walkInName: null, lanternType: "光明燈" });
      expect(await service.describeLanternSource(ReceiptSourceType.LANTERN_CLAIM, "c1")).toMatchObject({ payerName: "王小明", description: "光明燈" });
    });

    it("點燈：燈牆已不存在時備註只印燈位；連燈位都不存在就沒有備註、項目用「點燈」", async () => {
      repos.claim.findOne.mockResolvedValue({ slotId: "s1", memberId: null, walkInName: null, lanternType: null });
      repos.slot.findOne.mockResolvedValue({ id: "s1", wallId: "w1", code: "A-01" });
      repos.wall.findOne.mockResolvedValue(null);
      expect(await service.describeLanternSource(ReceiptSourceType.LANTERN_CLAIM, "c1")).toEqual({ payerName: "", description: "點燈", note: "燈位：A-01" });

      repos.slot.findOne.mockResolvedValue(null);
      expect((await service.describeLanternSource(ReceiptSourceType.LANTERN_CLAIM, "c1")).note).toBeUndefined();
    });

    it("點燈紀錄已刪除、或不是點燈／捐款的來源類型：回傳空白", async () => {
      expect(await service.describeLanternSource(ReceiptSourceType.LANTERN_CLAIM, "gone")).toEqual({ payerName: "", description: "" });
      expect(await service.describeLanternSource(ReceiptSourceType.COMBINED, "x")).toEqual({ payerName: "", description: "" });
    });
  });

  describe("作廢與刪除收據", () => {
    const receipt = (overrides: object = {}) => ({
      id: "r1",
      receiptNo: "R1",
      sourceType: ReceiptSourceType.COMBINED,
      sourceId: null,
      amount: "100.00",
      status: ReceiptStatus.ISSUED,
      issuedByUserId: "u1",
      createdAt: new Date(),
      items: [
        {
          description: "x",
          amount: 100,
          sourceRefs: [
            { sourceType: ReceiptSourceType.LANTERN_CLAIM, sourceId: "claim1" },
            { sourceType: ReceiptSourceType.CEREMONY_REGISTRATION, sourceId: "reg1" },
            { sourceType: ReceiptSourceType.DONATION, sourceId: "don1" },
            { sourceType: ReceiptSourceType.GIFT, sourceId: "gift1" },
          ],
        },
      ],
      ...overrides,
    });

    it("作廢：找不到 404；已作廢 409", async () => {
      await expect(service.voidReceipt("x", "原因", "u2")).rejects.toThrow(NotFoundException);
      repos.receipt.findOne.mockResolvedValue(receipt({ status: ReceiptStatus.VOIDED }));
      await expect(service.voidReceipt("r1", "原因", "u2")).rejects.toThrow("收據已經作廢過了");
    });

    it("作廢：只釋放點燈與活動座位，捐款與送禮的紀錄保留；寫入稽核紀錄", async () => {
      repos.receipt.findOne.mockResolvedValue(receipt());
      repos.claim.findOne.mockResolvedValue({ id: "claim1", slotId: "s1" });
      repos.slot.findOne.mockResolvedValue({ id: "s1", wallId: "w1", code: "A-01" });
      const result = await service.voidReceipt("r1", "打錯", "u2");

      expect(result.status).toBe(ReceiptStatus.VOIDED);
      expect(repos.claim.remove).toHaveBeenCalledTimes(1);
      expect(repos.registration.delete).toHaveBeenCalledWith({ id: "reg1" });
      expect(repos.donation.delete).not.toHaveBeenCalled();
      expect(repos.gift.delete).not.toHaveBeenCalled();
      expect(gateway.broadcastSlotClaimed).toHaveBeenCalledWith(expect.objectContaining({ wallId: "w1" }));
      expect(repos.auditLog.create).toHaveBeenCalledWith({ receiptId: "r1", action: "VOID", performedByUserId: "u2", reason: "打錯" });
    });

    it("永久刪除：四種來源紀錄全部清掉，連稽核紀錄一起刪", async () => {
      await expect(service.deleteReceipt("x")).rejects.toThrow("找不到收據");
      repos.receipt.findOne.mockResolvedValue(receipt());
      repos.claim.findOne.mockResolvedValue(null); // 點燈紀錄已經不在：略過，不出錯
      await service.deleteReceipt("r1");
      expect(repos.claim.remove).not.toHaveBeenCalled();
      expect(repos.registration.delete).toHaveBeenCalledWith({ id: "reg1" });
      expect(repos.donation.delete).toHaveBeenCalledWith({ id: "don1" });
      expect(repos.gift.delete).toHaveBeenCalledWith({ id: "gift1" });
      expect(repos.auditLog.delete).toHaveBeenCalledWith({ receiptId: "r1" });
      expect(repos.receipt.remove).toHaveBeenCalled();
    });

    it("釋放燈位時燈位已不存在：仍然刪除認領紀錄，只是不廣播", async () => {
      repos.claim.findOne.mockResolvedValue({ id: "claim1", slotId: "gone" });
      await internals.deleteSourceRef({ sourceType: ReceiptSourceType.LANTERN_CLAIM, sourceId: "claim1" });
      expect(repos.claim.remove).toHaveBeenCalled();
      expect(gateway.broadcastSlotClaimed).not.toHaveBeenCalled();
    });
  });

  describe("getVoidedSourceIds / getReceiptIdsBySource", () => {
    it("空陣列不查資料庫", async () => {
      expect((await service.getVoidedSourceIds(ReceiptSourceType.DONATION, [])).size).toBe(0);
      expect((await service.getReceiptIdsBySource(ReceiptSourceType.DONATION, [])).size).toBe(0);
      expect(repos.receipt.find).not.toHaveBeenCalled();
    });

    it("已作廢的來源：單筆收據與合併收據裡的都算，類型或 id 不符的不算", async () => {
      repos.receipt.find
        .mockResolvedValueOnce([{ sourceId: "a" }, { sourceId: null }])
        .mockResolvedValueOnce([
          {
            items: [
              {
                sourceRefs: [
                  { sourceType: ReceiptSourceType.DONATION, sourceId: "b" },
                  { sourceType: ReceiptSourceType.LANTERN_CLAIM, sourceId: "c" },
                  { sourceType: ReceiptSourceType.DONATION, sourceId: "不在查詢名單" },
                ],
              },
              {},
            ],
          },
          { items: null },
        ]);
      const voided = await service.getVoidedSourceIds(ReceiptSourceType.DONATION, ["a", "b", "c"]);
      expect([...voided].sort()).toEqual(["a", "b"]);
    });

    it("來源對應的收據：單筆收據優先，合併收據不會蓋掉已找到的", async () => {
      repos.receipt.find
        .mockResolvedValueOnce([{ id: "single", sourceId: "a" }])
        .mockResolvedValueOnce([
          { id: "combined", items: [{ sourceRefs: [{ sourceType: ReceiptSourceType.DONATION, sourceId: "a" }, { sourceType: ReceiptSourceType.DONATION, sourceId: "b" }] }] },
        ]);
      const map = await service.getReceiptIdsBySource(ReceiptSourceType.DONATION, ["a", "b", "c"]);
      expect(Object.fromEntries(map)).toEqual({ a: "single", b: "combined" });
    });
  });

  describe("認領燈位的內部分支", () => {
    it("燈位或燈牆不存在 404；撞到唯一約束 409；其他錯誤原樣往外丟", async () => {
      const dto = { slotId: "s1", walkInName: "甲", amount: 600 };
      await expect(service.claimSlotForCombined(dto as never, "u1")).rejects.toThrow("找不到燈位");
      repos.slot.findOne.mockResolvedValue({ id: "s1", wallId: "w1", code: "A-01" });
      await expect(service.claimSlotForCombined(dto as never, "u1")).rejects.toThrow("找不到燈牆");
      repos.wall.findOne.mockResolvedValue({ id: "w1", year: 2026, templeId: "t1", name: "右牆" });
      repos.claim.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.claimSlotForCombined(dto as never, "u1")).rejects.toThrow(ConflictException);
      const dbError = otherDbError();
      repos.claim.save.mockRejectedValueOnce(dbError);
      await expect(service.claimSlotForCombined(dto as never, "u1")).rejects.toBe(dbError);
      expect(gateway.broadcastSlotClaimed).not.toHaveBeenCalled();
    });

    it("同時有信徒與臨櫃姓名時以信徒為準（臨櫃姓名不存）；年份用燈牆的年份；成功後廣播", async () => {
      repos.slot.findOne.mockResolvedValue({ id: "s1", wallId: "w1", code: "A-01" });
      repos.wall.findOne.mockResolvedValue({ id: "w1", year: 2030, templeId: "t1", name: "右牆" });
      await service.claimSlotForCombined({ slotId: "s1", memberId: "m1", walkInName: "會被忽略", amount: 600.5 } as never, "u1");
      expect(repos.claim.create).toHaveBeenCalledWith(expect.objectContaining({ year: 2030, memberId: "m1", walkInName: null, amount: "600.50" }));
      expect(gateway.broadcastSlotClaimed).toHaveBeenCalledTimes(1);
    });

    it("整戶點燈：燈位不屬於這面燈牆、或有燈位查不到 → 400", async () => {
      repos.wall.findOne.mockResolvedValue({ id: "w1", year: 2026, templeId: "t1" });
      household.findMembersByHouseholdId.mockResolvedValue([{ id: "m1", name: "甲" }, { id: "m2", name: "乙" }]);
      const dto = { wallId: "w1", householdId: "h1", slotIds: ["s1", "s2"], amount: 1200 };
      repos.slot.find.mockResolvedValue([{ id: "s1", wallId: "w1" }]);
      await expect(service.claimSlotsForHouseholdCombined(dto, "u1")).rejects.toThrow("燈位不屬於此燈牆");
      repos.slot.find.mockResolvedValue([{ id: "s1", wallId: "w1" }, { id: "s2", wallId: "other" }]);
      await expect(service.claimSlotsForHouseholdCombined(dto, "u1")).rejects.toThrow("燈位不屬於此燈牆");
    });

    it("修改認領資料：改成信徒時清掉臨櫃姓名；改成臨櫃姓名時清掉信徒；送空的信徒 id 只清信徒", async () => {
      await expect(service.updateClaim("x", {})).rejects.toThrow("找不到點燈紀錄");
      const claim = () => ({ id: "c1", slotId: "s1", memberId: null as string | null, walkInName: "舊姓名" as string | null, amount: "600.00" });
      repos.slot.findOne.mockResolvedValue({ id: "s1", wallId: "w1", code: "A-01" });

      repos.claim.findOne.mockResolvedValue(claim());
      await service.updateClaim("c1", { memberId: "m1" });
      expect(repos.claim.save.mock.calls[0][0]).toMatchObject({ memberId: "m1", walkInName: null });

      repos.claim.findOne.mockResolvedValue({ ...claim(), memberId: "m1", walkInName: null });
      await service.updateClaim("c1", { walkInName: "新姓名" });
      expect(repos.claim.save.mock.calls[1][0]).toMatchObject({ memberId: null, walkInName: "新姓名" });

      repos.claim.findOne.mockResolvedValue({ ...claim(), memberId: "m1" });
      await service.updateClaim("c1", { memberId: null });
      expect(repos.claim.save.mock.calls[2][0]).toMatchObject({ memberId: null, walkInName: "舊姓名" });

      repos.slot.findOne.mockResolvedValue(null);
      repos.claim.findOne.mockResolvedValue(claim());
      await expect(service.updateClaim("c1", { wishText: "x" })).rejects.toThrow("找不到燈位");
    });
  });

  it("合併收據：金額是各項目加總，存兩位小數", async () => {
    await service.issueCombinedReceipt(
      [{ description: "a", amount: 600 }, { description: "b", amount: 0 }, { description: "c", amount: 1000.5 }],
      "王小明",
      "u1",
      "t1",
    );
    expect(repos.receipt.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "1600.50", sourceType: ReceiptSourceType.COMBINED, sourceId: null, payerName: "王小明", status: ReceiptStatus.ISSUED }),
    );
    expect(repos.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "ISSUE", performedByUserId: "u1" }));
  });
});
