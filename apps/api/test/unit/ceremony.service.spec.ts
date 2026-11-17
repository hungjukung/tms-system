import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { CeremonyFeeMode, CeremonyKind, CeremonySession, ReceiptSourceType } from "@tms/shared";
import { CeremonyService } from "../../src/ceremony/ceremony.service";
import { mockRepo, MockRepo, otherDbError, uniqueViolation } from "./support/mocks";

const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "22222222-2222-4222-8222-222222222222";

/**
 * 白箱單元測試：CeremonyService。
 * 資料庫全部用 mock，依照程式內部的 if / for / try-catch 分支逐一設計案例，
 * 包含只能從內部觸發的路徑（例如「取號連續撞號 5 次」「自動配位遇到被手動選走的座位」）。
 */
describe("CeremonyService（白箱）", () => {
  let ceremonyRepo: MockRepo;
  let registrationRepo: MockRepo;
  let userRepo: MockRepo;
  let ledgerRepo: MockRepo;
  let householdService: Record<string, jest.Mock>;
  let lanternService: Record<string, jest.Mock>;
  let service: CeremonyService;
  // 白箱測試需要直接呼叫 private 方法
  let internals: any;

  const general = (overrides: object = {}) => ({
    id: "c1",
    templeId: "t1",
    name: "中元普渡",
    date: "2099-01-01",
    kind: CeremonyKind.GENERAL,
    feeMode: CeremonyFeeMode.FREE_WILL,
    fixedAmount: null,
    description: null,
    tableCount: 2,
    seatsPerTable: 3,
    nextSeatIndex: 0,
    morningCapacity: null,
    afternoonCapacity: null,
    registrationDeadline: null,
    ...overrides,
  });
  const jigai = (overrides: object = {}) =>
    general({ name: "祭改", kind: CeremonyKind.JIGAI, tableCount: null, seatsPerTable: null, morningCapacity: 3, afternoonCapacity: 2, ...overrides });
  const DOUBLE_ROOM = { name: "雙人房", capacity: 2, fee: 3000, roomCount: 2 };
  const pilgrimage = (overrides: object = {}) =>
    general({
      name: "進香",
      kind: CeremonyKind.PILGRIMAGE,
      tableCount: null,
      seatsPerTable: null,
      busCount: 1,
      roomTypes: [DOUBLE_ROOM],
      ...overrides,
    });

  beforeEach(() => {
    ceremonyRepo = mockRepo();
    registrationRepo = mockRepo();
    userRepo = mockRepo();
    ledgerRepo = mockRepo();
    householdService = {
      findMemberById: jest.fn().mockResolvedValue({ id: MEMBER_A, name: "王小明" }),
      findMemberByIdOrNull: jest.fn().mockResolvedValue({ id: MEMBER_A, name: "王小明" }),
      findMembersByIds: jest.fn().mockResolvedValue(new Map()),
      findMembersByHouseholdId: jest.fn().mockResolvedValue([]),
      findHouseholdAddressByMemberId: jest.fn().mockResolvedValue(null),
    };
    lanternService = {
      issueReceipt: jest.fn().mockResolvedValue({ id: "r1" }),
      getVoidedSourceIds: jest.fn().mockResolvedValue(new Set()),
      getReceiptIdsBySource: jest.fn().mockResolvedValue(new Map()),
      getCeremonyDonationSummary: jest.fn().mockResolvedValue({ total: 0, items: [] }),
    };
    service = new CeremonyService(
      ceremonyRepo as never,
      registrationRepo as never,
      userRepo as never,
      ledgerRepo as never,
      householdService as never,
      lanternService as never,
    );
    internals = service;
  });

  // ───────────────────────────── 內部小工具 ─────────────────────────────
  describe("座位換算（private helpers）", () => {
    it("formatSeatNumber：流水號換成「桌-位」，每桌的第一個與最後一個都算對", () => {
      expect(internals.formatSeatNumber(1, 3)).toBe("1-1");
      expect(internals.formatSeatNumber(3, 3)).toBe("1-3");
      expect(internals.formatSeatNumber(4, 3)).toBe("2-1");
      expect(internals.formatSeatNumber(6, 3)).toBe("2-3");
    });

    it("totalSeatsOf：一般活動＝桌數×每桌人數；沒設桌數是 null；祭改、進香不選座位，都是 null", () => {
      expect(internals.totalSeatsOf(general())).toBe(6);
      expect(internals.totalSeatsOf(general({ tableCount: null }))).toBeNull();
      expect(internals.totalSeatsOf(general({ seatsPerTable: null }))).toBeNull();
      expect(internals.totalSeatsOf(jigai())).toBeNull();
      expect(internals.totalSeatsOf(pilgrimage())).toBeNull();
    });

    it("isValidSeat：一般活動看 1～總座位數；進香沒有座位，一律不合法", () => {
      const c = general();
      expect([0, 1, 6, 7, 1.5].map((i) => internals.isValidSeat(c, i))).toEqual([false, true, true, false, false]);
      expect(internals.isValidSeat(general({ tableCount: null }), 1)).toBe(false);
      expect(internals.isValidSeat(pilgrimage(), 1)).toBe(false);
    });

    it("seatNumberOf / seatOnlyLabel：依每桌人數換算成「桌-位」與「2桌1號」", () => {
      expect(internals.seatNumberOf(general(), 4)).toBe("2-1");
      expect(internals.seatOnlyLabel(general(), 4)).toBe("2桌1號");
      expect(internals.seatOnlyLabel(general(), 6)).toBe("2桌3號");
    });

    it("pickRoomNumber：取該房型最小的空房號；中間有空房先補；訂滿回傳 null；間數不限就一直往後", () => {
      expect(internals.pickRoomNumber(new Set(), 2)).toBe(1);
      expect(internals.pickRoomNumber(new Set([2]), 2)).toBe(1);
      expect(internals.pickRoomNumber(new Set([1]), 2)).toBe(2);
      expect(internals.pickRoomNumber(new Set([1, 2]), 2)).toBeNull();
      expect(internals.pickRoomNumber(new Set([1, 2, 3]), null)).toBe(4);
    });

    it("normalizeRoomTypes：去掉名稱前後空白、沒給間數存 null；沒有房型回傳 null；名稱空白或重複 400", () => {
      expect(internals.normalizeRoomTypes(undefined)).toBeNull();
      expect(internals.normalizeRoomTypes([])).toBeNull();
      expect(internals.normalizeRoomTypes([{ name: " 雙人房 ", capacity: 2, fee: 3000 }])).toEqual([
        { name: "雙人房", capacity: 2, fee: 3000, roomCount: null },
      ]);
      expect(() => internals.normalizeRoomTypes([{ name: "  ", capacity: 2, fee: 0 }])).toThrow("房型名稱不可空白");
      expect(() =>
        internals.normalizeRoomTypes([
          { name: "雙人房", capacity: 2, fee: 0 },
          { name: "雙人房 ", capacity: 4, fee: 0 },
        ]),
      ).toThrow("房型名稱不可重複");
    });

    it("formatSeatLabel：依活動種類決定「桌」或「排」（「排」只用在改版前遊覽車選位的舊資料）", () => {
      expect(internals.formatSeatLabel("1-8")).toBe("座位：1桌8號");
      expect(internals.formatSeatLabel("1-8", CeremonyKind.GENERAL)).toBe("座位：1桌8號");
      expect(internals.formatSeatLabel("3-2", CeremonyKind.PILGRIMAGE)).toBe("座位：3排2號");
    });

    it("formatQueueLabel：上午／下午場；場次不明時只印號碼", () => {
      expect(internals.formatQueueLabel(CeremonySession.AM, 3)).toBe("上午場 3號");
      expect(internals.formatQueueLabel(CeremonySession.PM, 12)).toBe("下午場 12號");
      expect(internals.formatQueueLabel(null, 5)).toBe("5號");
    });

    it("pickQueueNumber：取最小的空號；中間有空號先補；額滿回傳 null；上限 0 一律 null", () => {
      expect(internals.pickQueueNumber(new Set(), 3)).toBe(1);
      expect(internals.pickQueueNumber(new Set([1, 2]), 3)).toBe(3);
      expect(internals.pickQueueNumber(new Set([1, 3]), 3)).toBe(2);
      expect(internals.pickQueueNumber(new Set([1, 2, 3]), 3)).toBeNull();
      expect(internals.pickQueueNumber(new Set(), 0)).toBeNull();
    });

    it("capacityOf：依場次取上限，沒設定當成 0", () => {
      const c = jigai({ morningCapacity: 3, afternoonCapacity: null });
      expect(internals.capacityOf(c, CeremonySession.AM)).toBe(3);
      expect(internals.capacityOf(c, CeremonySession.PM)).toBe(0);
    });

    it("formatLocalDate：本地時間的 YYYY-MM-DD", () => {
      expect(internals.formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    });
  });

  describe("報名期限與固定金額的把關（private helpers）", () => {
    // it.each 的案例表在測試註冊階段就會執行，那時 beforeEach 還沒建立 service，所以這裡自己組日期字串
    const shift = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const todayText = () => shift(0);

    it.each([
      ["沒設期限、活動日期是今天", { date: todayText(), registrationDeadline: null }, false],
      ["沒設期限、活動日期是昨天", { date: shift(-1), registrationDeadline: null }, true],
      ["設了期限、期限是今天（活動已過）", { date: shift(-9), registrationDeadline: todayText() }, false],
      ["設了期限、期限是昨天（活動還沒到）", { date: shift(9), registrationDeadline: shift(-1) }, true],
      ["設了期限、期限在未來", { date: shift(-9), registrationDeadline: shift(1) }, false],
    ])("%s", (_label, fields, blocked) => {
      const call = () => internals.assertRegistrationOpen(general(fields));
      if (blocked) expect(call).toThrow(new BadRequestException("此活動已過報名期限，無法報名"));
      else expect(call).not.toThrow();
    });

    it("固定金額：以分比對（0.1 × 3 = 0.3 不會因浮點誤差失敗）；差一分就擋下", () => {
      const fixed = (fixedAmount: string) => general({ feeMode: CeremonyFeeMode.FIXED_AMOUNT, fixedAmount });
      expect(() => internals.assertAmountMatchesFixedFee(fixed("0.10"), 0.3, 3)).not.toThrow();
      expect(() => internals.assertAmountMatchesFixedFee(fixed("0.10"), 0.31, 3)).toThrow("3 人應收 NT$ 0.3");
      expect(() => internals.assertAmountMatchesFixedFee(fixed("500.00"), 500, 1)).not.toThrow();
      expect(() => internals.assertAmountMatchesFixedFee(fixed("500.00"), 499.99, 1)).toThrow(BadRequestException);
    });

    it("隨喜、或固定金額卻沒有存單價：不檢查", () => {
      expect(() => internals.assertAmountMatchesFixedFee(general(), 12345, 1)).not.toThrow();
      expect(() =>
        internals.assertAmountMatchesFixedFee(general({ feeMode: CeremonyFeeMode.FIXED_AMOUNT, fixedAmount: null }), 1, 1),
      ).not.toThrow();
    });

    it("建立活動：廟宇不存在 404，不寫入資料庫；存在就建立", async () => {
      ceremonyRepo.manager.findOne.mockResolvedValueOnce(null);
      await expect(
        service.createCeremony({ templeId: "x", name: "a", date: "2099-01-01", feeMode: CeremonyFeeMode.FREE_WILL } as never),
      ).rejects.toThrow(new NotFoundException("找不到此廟宇"));
      expect(ceremonyRepo.save).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────── 建立活動 ─────────────────────────────
  describe("createCeremony", () => {
    const dto = (overrides: object = {}) => ({
      templeId: "t1",
      name: "活動",
      date: "2099-01-01",
      feeMode: CeremonyFeeMode.FREE_WILL,
      ...overrides,
    });

    it("一般活動：保留桌次設定，場次人數一律清空；沒給 kind 預設是一般活動", async () => {
      await service.createCeremony(dto({ tableCount: 2, seatsPerTable: 3, morningCapacity: 9 }) as never);
      expect(ceremonyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: CeremonyKind.GENERAL, tableCount: 2, seatsPerTable: 3, morningCapacity: null, afternoonCapacity: null }),
      );
    });

    it("固定金額存成兩位小數的字串；沒給金額存 null", async () => {
      await service.createCeremony(dto({ feeMode: CeremonyFeeMode.FIXED_AMOUNT, fixedAmount: 500 }) as never);
      expect(ceremonyRepo.create).toHaveBeenLastCalledWith(expect.objectContaining({ fixedAmount: "500.00" }));
      await service.createCeremony(dto() as never);
      expect(ceremonyRepo.create).toHaveBeenLastCalledWith(expect.objectContaining({ fixedAmount: null }));
    });

    it.each([
      ["兩場都沒填", {}],
      ["只填上午", { morningCapacity: 5 }],
      ["只填下午", { afternoonCapacity: 5 }],
    ])("祭改缺場次人數（%s）：400，而且不會寫入資料庫", async (_label, capacities) => {
      await expect(service.createCeremony(dto({ kind: CeremonyKind.JIGAI, ...capacities }) as never)).rejects.toThrow(
        new BadRequestException("祭改活動請設定上午場與下午場人數"),
      );
      expect(ceremonyRepo.save).not.toHaveBeenCalled();
    });

    it("祭改：存場次人數，桌次設定被忽略", async () => {
      await service.createCeremony(
        dto({ kind: CeremonyKind.JIGAI, morningCapacity: 10, afternoonCapacity: 20, tableCount: 5, seatsPerTable: 5 }) as never,
      );
      expect(ceremonyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: CeremonyKind.JIGAI, morningCapacity: 10, afternoonCapacity: 20, tableCount: null, seatsPerTable: null }),
      );
    });

    it("進香：存遊覽車台數與房型，桌次與場次人數都忽略；可載人數 = 台數 × 40，沒有座位總數", async () => {
      const result = await service.createCeremony(
        dto({
          kind: CeremonyKind.PILGRIMAGE,
          busCount: 2,
          roomTypes: [{ ...DOUBLE_ROOM, name: " 雙人房 " }],
          tableCount: 5,
          seatsPerTable: 5,
          morningCapacity: 5,
          afternoonCapacity: 5,
        }) as never,
      );
      expect(ceremonyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: CeremonyKind.PILGRIMAGE,
          busCount: 2,
          roomTypes: [DOUBLE_ROOM],
          tableCount: null,
          seatsPerTable: null,
          morningCapacity: null,
        }),
      );
      expect(result).toMatchObject({ totalSeats: null, busCount: 2, busCapacity: 80 });
      expect(result.roomTypes).toEqual([{ ...DOUBLE_ROOM, roomsBooked: 0 }]);
    });

    it.each([
      ["沒有遊覽車台數", { roomTypes: [DOUBLE_ROOM] }, "進香活動請設定遊覽車台數"],
      ["沒有房型", { busCount: 1 }, "進香活動請至少設定一種房型"],
      ["房型是空陣列", { busCount: 1, roomTypes: [] }, "進香活動請至少設定一種房型"],
    ])("進香%s：400，而且不會寫入資料庫", async (_label, overrides, message) => {
      await expect(service.createCeremony(dto({ kind: CeremonyKind.PILGRIMAGE, ...overrides }) as never)).rejects.toThrow(
        new BadRequestException(message),
      );
      expect(ceremonyRepo.save).not.toHaveBeenCalled();
    });

    it("非進香活動：房型與遊覽車台數都不存", async () => {
      await service.createCeremony(dto({ busCount: 3, roomTypes: [DOUBLE_ROOM] }) as never);
      expect(ceremonyRepo.create).toHaveBeenCalledWith(expect.objectContaining({ busCount: null, roomTypes: null }));
    });
  });

  // ───────────────────────────── 編輯活動 ─────────────────────────────
  describe("updateCeremony", () => {
    it("找不到活動：404", async () => {
      await expect(service.updateCeremony("x", {} as never)).rejects.toThrow(NotFoundException);
    });

    it("已有報名時改每桌人數：400；沒有報名時可以改", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      registrationRepo.count.mockResolvedValue(1);
      await expect(service.updateCeremony("c1", { seatsPerTable: 5 } as never)).rejects.toThrow("此活動已有信眾報名，無法修改每桌人數");

      registrationRepo.count.mockResolvedValue(0);
      registrationRepo.qb.getRawOne.mockResolvedValue({ count: "0", total: null, seatsAssigned: "0", morning: "0", afternoon: "0" });
      const result = await service.updateCeremony("c1", { seatsPerTable: 5 } as never);
      expect(result.seatsPerTable).toBe(5);
    });

    it("每桌人數送來的值跟原本一樣：不算修改，不會去查報名筆數", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      registrationRepo.qb.getRawOne.mockResolvedValue({ count: "3", total: "300", seatsAssigned: "3", morning: "0", afternoon: "0" });
      await service.updateCeremony("c1", { seatsPerTable: 3 } as never);
      expect(registrationRepo.count).not.toHaveBeenCalled();
    });

    it("縮減桌數：以「自動配位計數器」與「手動選位最大座位」兩者較大的為準", async () => {
      // 手動選到第 5 個座位，計數器只到 2 → 以 5 為準；每桌 3 人，縮成 1 桌（3 個座位）不行
      ceremonyRepo.findOne.mockResolvedValue(general({ tableCount: 3, nextSeatIndex: 2 }));
      registrationRepo.qb.getRawOne.mockResolvedValue({ max: "5" });
      await expect(service.updateCeremony("c1", { tableCount: 1 } as never)).rejects.toThrow("已配發的座位超出新桌數的範圍，無法縮減桌數");

      // 計數器到 6、沒有手動選位 → 以 6 為準；縮成 2 桌（6 個座位）剛好可以
      ceremonyRepo.findOne.mockResolvedValue(general({ tableCount: 3, nextSeatIndex: 6 }));
      registrationRepo.qb.getRawOne.mockResolvedValueOnce({ max: null }).mockResolvedValue({ count: "6", total: "0", seatsAssigned: "6", morning: "0", afternoon: "0" });
      const result = await service.updateCeremony("c1", { tableCount: 2 } as never);
      expect(result.tableCount).toBe(2);
    });

    it("改成隨喜且沒給金額：固定金額清成 null；有給金額就照給的存", async () => {
      registrationRepo.qb.getRawOne.mockResolvedValue({ count: "0", total: null, seatsAssigned: "0", morning: "0", afternoon: "0" });
      ceremonyRepo.findOne.mockResolvedValue(general({ feeMode: CeremonyFeeMode.FIXED_AMOUNT, fixedAmount: "500.00" }));
      expect((await service.updateCeremony("c1", { feeMode: CeremonyFeeMode.FREE_WILL } as never)).fixedAmount).toBeNull();

      ceremonyRepo.findOne.mockResolvedValue(general());
      expect((await service.updateCeremony("c1", { fixedAmount: 800 } as never)).fixedAmount).toBe(800);

      ceremonyRepo.findOne.mockResolvedValue(general({ fixedAmount: "500.00" }));
      expect((await service.updateCeremony("c1", { fixedAmount: null } as never)).fixedAmount).toBeNull();
    });

    it("祭改：人數上限低於已報名人數 400；等於或高於可以；沒送的場次不檢查", async () => {
      registrationRepo.qb.getRawOne.mockResolvedValue({ count: "2", total: "0", seatsAssigned: "0", morning: "2", afternoon: "0" });
      ceremonyRepo.findOne.mockResolvedValue(jigai());
      registrationRepo.count.mockResolvedValue(2);
      await expect(service.updateCeremony("c1", { morningCapacity: 1 } as never)).rejects.toThrow("上午場已有 2 人報名，人數上限不可低於此數");
      await expect(service.updateCeremony("c1", { afternoonCapacity: 1 } as never)).rejects.toThrow("下午場已有 2 人報名");

      ceremonyRepo.findOne.mockResolvedValue(jigai());
      registrationRepo.count.mockClear();
      const result = await service.updateCeremony("c1", { morningCapacity: 2 } as never);
      expect(result.morningCapacity).toBe(2);
      expect(registrationRepo.count).toHaveBeenCalledTimes(1); // 只檢查有送來的上午場
    });

    it("祭改／進香送桌次設定會被忽略；一般活動送場次人數也會被忽略", async () => {
      registrationRepo.qb.getRawOne.mockResolvedValue({ count: "0", total: null, seatsAssigned: "0", morning: "0", afternoon: "0" });
      ceremonyRepo.findOne.mockResolvedValue(pilgrimage());
      const p = await service.updateCeremony("c1", { tableCount: 9, seatsPerTable: 9 } as never);
      expect(p).toMatchObject({ tableCount: null, seatsPerTable: null, totalSeats: null });

      ceremonyRepo.findOne.mockResolvedValue(general());
      const g = await service.updateCeremony("c1", { morningCapacity: 9 } as never);
      expect(g.morningCapacity).toBeNull();
    });
  });

  describe("updateCeremony：進香的遊覽車台數與房型", () => {
    beforeEach(() => {
      registrationRepo.qb.getRawOne.mockResolvedValue({ count: "0", total: null, seatsAssigned: "0", morning: "0", afternoon: "0" });
    });

    it("台數不能少於已報名人數需要的台數（41 人要 2 台）；夠載就可以改", async () => {
      ceremonyRepo.findOne.mockResolvedValue(pilgrimage({ busCount: 3 }));
      registrationRepo.count.mockResolvedValue(41);
      await expect(service.updateCeremony("c1", { busCount: 1 } as never)).rejects.toThrow("已有 41 人報名，遊覽車至少需要 2 台");
      const result = await service.updateCeremony("c1", { busCount: 2 } as never);
      expect(result).toMatchObject({ busCount: 2, busCapacity: 80 });
    });

    it.each([
      ["刪掉已有人訂的房型", [], "「雙人房」已有人預訂，不能刪除或改名"],
      ["把已有人訂的房型改名", [{ ...DOUBLE_ROOM, name: "標準房" }], "「雙人房」已有人預訂，不能刪除或改名"],
      ["間數少於已訂間數", [{ ...DOUBLE_ROOM, roomCount: 1 }], "「雙人房」已訂 2 間，間數不可少於此數"],
      ["每間人數少於已入住人數", [{ ...DOUBLE_ROOM, capacity: 1 }], "「雙人房」已有一間住 2 人，每間人數不可少於此數"],
    ])("房型：%s → 400，不存檔", async (_label, roomTypes, message) => {
      ceremonyRepo.findOne.mockResolvedValue(pilgrimage());
      registrationRepo.qb.getRawMany.mockResolvedValueOnce([
        { roomType: "雙人房", roomNumber: 1, occupants: "2" },
        { roomType: "雙人房", roomNumber: 2, occupants: "1" },
      ]);
      await expect(service.updateCeremony("c1", { roomTypes } as never)).rejects.toThrow(new BadRequestException(message));
      expect(ceremonyRepo.save).not.toHaveBeenCalled();
    });

    it("房型：加間數、新增房型可以；回傳每個房型已訂幾間", async () => {
      ceremonyRepo.findOne.mockResolvedValue(pilgrimage());
      registrationRepo.qb.getRawMany
        .mockResolvedValueOnce([{ roomType: "雙人房", roomNumber: 1, occupants: "2" }])
        .mockResolvedValueOnce([{ ceremonyId: "c1", roomType: "雙人房", rooms: "1" }]);
      const single = { name: "單人房", capacity: 1, fee: 2000, roomCount: 3 };
      const result = await service.updateCeremony("c1", { roomTypes: [{ ...DOUBLE_ROOM, roomCount: 5 }, single] } as never);
      expect(result.roomTypes).toEqual([
        { ...DOUBLE_ROOM, roomCount: 5, roomsBooked: 1 },
        { ...single, roomsBooked: 0 },
      ]);
    });

    it("非進香活動送房型與台數：忽略", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      const result = await service.updateCeremony("c1", { busCount: 3, roomTypes: [DOUBLE_ROOM] } as never);
      expect(result).toMatchObject({ busCount: null, roomTypes: null });
      expect(registrationRepo.count).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────── 列表／刪除 ─────────────────────────────
  describe("listCeremonies / deleteCeremony", () => {
    it("沒有條件時不加任何篩選；有 templeId、activeOnly 才各自加上條件", async () => {
      await service.listCeremonies();
      expect(ceremonyRepo.qb.andWhere).not.toHaveBeenCalled();

      await service.listCeremonies("t1", true);
      expect(ceremonyRepo.qb.andWhere).toHaveBeenCalledTimes(2);
      expect(ceremonyRepo.qb.andWhere).toHaveBeenCalledWith("ceremony.templeId = :templeId", { templeId: "t1" });
    });

    it("沒有任何活動時直接回傳空陣列，不去查統計", async () => {
      expect(await service.listCeremonies()).toEqual([]);
      expect(registrationRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it("統計資料對不上的活動（沒人報名）數字都是 0", async () => {
      ceremonyRepo.qb.getMany.mockResolvedValue([general({ id: "a" }), general({ id: "b" })]);
      registrationRepo.qb.getRawMany.mockResolvedValue([
        { ceremonyId: "a", count: "2", total: "700", seatsAssigned: "1", morning: "0", afternoon: "0" },
      ]);
      const [a, b] = await service.listCeremonies();
      expect(a).toMatchObject({ registrationCount: 2, totalAmount: 700, seatsAssigned: 1 });
      expect(b).toMatchObject({ registrationCount: 0, totalAmount: 0, seatsAssigned: 0 });
    });

    it("刪除：找不到 404；有報名且沒 force 409；force 或沒有報名就刪", async () => {
      await expect(service.deleteCeremony("x")).rejects.toThrow(NotFoundException);

      ceremonyRepo.findOne.mockResolvedValue(general());
      registrationRepo.count.mockResolvedValue(2);
      await expect(service.deleteCeremony("c1")).rejects.toThrow(ConflictException);
      expect(ceremonyRepo.remove).not.toHaveBeenCalled();

      await service.deleteCeremony("c1", true);
      expect(ceremonyRepo.remove).toHaveBeenCalledTimes(1);

      registrationRepo.count.mockResolvedValue(0);
      await service.deleteCeremony("c1");
      expect(ceremonyRepo.remove).toHaveBeenCalledTimes(2);
    });
  });

  // ───────────────────────────── 一般活動報名 ─────────────────────────────
  describe("一般活動報名（createRegistrationRecord）", () => {
    const dto = (overrides: object = {}) => ({ ceremonyId: "c1", walkInName: "甲", amount: 100, ...overrides });

    it("活動不存在 404；信徒不存在時把 HouseholdService 的錯誤往外丟", async () => {
      await expect(service.register(dto() as never, "u1")).rejects.toThrow("找不到活動");
      ceremonyRepo.findOne.mockResolvedValue(general());
      householdService.findMemberById.mockRejectedValue(new NotFoundException("找不到信徒資料"));
      await expect(service.register(dto({ memberId: MEMBER_A }) as never, "u1")).rejects.toThrow("找不到信徒資料");
    });

    it("手動選位：座位超出範圍 400；活動沒設座位 400；成功時存座位並開收據", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      await expect(service.register(dto({ seatIndex: 7 }) as never, "u1")).rejects.toThrow("座位超出範圍");

      ceremonyRepo.findOne.mockResolvedValue(general({ tableCount: null }));
      await expect(service.register(dto({ seatIndex: 1 }) as never, "u1")).rejects.toThrow("此活動未設定座位");

      ceremonyRepo.findOne.mockResolvedValue(general());
      userRepo.findOne.mockResolvedValue({ displayName: "櫃台" });
      const result = await service.register(dto({ seatIndex: 4 }) as never, "u1");
      expect(result.registration.seatNumber).toBe("2-1");
      expect(lanternService.issueReceipt).toHaveBeenCalledWith(
        ReceiptSourceType.CEREMONY_REGISTRATION,
        expect.any(String),
        100,
        "u1",
        "櫃台",
        "t1",
      );
    });

    it("手動選位撞到唯一約束：409；其他資料庫錯誤原樣往外丟（不會誤報成座位被選走）", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      registrationRepo.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.register(dto({ seatIndex: 1 }) as never, "u1")).rejects.toThrow(new ConflictException("此座位已被選走，請重新選擇"));

      const dbError = otherDbError();
      registrationRepo.save.mockRejectedValueOnce(dbError);
      await expect(service.register(dto({ seatIndex: 1 }) as never, "u1")).rejects.toBe(dbError);
    });

    it("自動配位：計數器給的座位已被手動選走時，往下一個號碼重試", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      // reserveNextSeat：第一次配到 1（已被選走）、第二次配到 2
      ceremonyRepo.qb.execute
        .mockResolvedValueOnce({ affected: 1, raw: [{ nextSeatIndex: 1 }] })
        .mockResolvedValueOnce({ affected: 1, raw: [{ nextSeatIndex: 2 }] });
      registrationRepo.save
        .mockImplementationOnce(async (row: object) => ({ id: "reg1", createdAt: new Date(), ...row })) // 先建立報名
        .mockRejectedValueOnce(uniqueViolation()) // 座位 1 撞號
        .mockImplementationOnce(async (row: object) => row); // 座位 2 成功
      const result = await service.register(dto() as never, "u1");
      expect(result.registration.seatNumber).toBe("1-2");
      expect(ceremonyRepo.qb.execute).toHaveBeenCalledTimes(2);
    });

    it("自動配位：座位已滿（計數器不再遞增）就不配位，報名仍然成立", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      ceremonyRepo.qb.execute.mockResolvedValue({ affected: 0, raw: [] });
      const result = await service.register(dto() as never, "u1");
      expect(result.registration.seatNumber == null).toBe(true);
      expect(registrationRepo.save).toHaveBeenCalledTimes(1);
    });

    it("自動配位：存座位時遇到非唯一約束的錯誤，原樣往外丟", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      ceremonyRepo.qb.execute.mockResolvedValue({ affected: 1, raw: [{ nextSeatIndex: 1 }] });
      const dbError = otherDbError();
      registrationRepo.save.mockImplementationOnce(async (row: object) => ({ id: "reg1", ...row })).mockRejectedValueOnce(dbError);
      await expect(service.register(dto() as never, "u1")).rejects.toBe(dbError);
    });

    it("不需要座位（noSeatNeeded）或活動沒設座位：完全不去動座位計數器", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      await service.register(dto({ noSeatNeeded: true }) as never, "u1");
      ceremonyRepo.findOne.mockResolvedValue(general({ tableCount: null, seatsPerTable: null }));
      await service.register(dto() as never, "u1");
      expect(ceremonyRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it("reserveNextSeat：UPDATE 有成功但沒回傳資料列時也當成沒座位", async () => {
      ceremonyRepo.qb.execute.mockResolvedValue({ affected: 1, raw: [] });
      expect(await internals.reserveNextSeat("c1", 6)).toBeNull();
      ceremonyRepo.qb.execute.mockResolvedValue({ affected: 1, raw: [{ nextSeatIndex: 3 }] });
      expect(await internals.reserveNextSeat("c1", 6)).toBe(3);
    });
  });

  // ───────────────────────────── 祭改 ─────────────────────────────
  describe("祭改報名（createJigaiRegistrationRecord）", () => {
    const dto = (overrides: object = {}) => ({ ceremonyId: "c1", walkInName: "甲", amount: 300, session: CeremonySession.AM, ...overrides });
    const used = (...numbers: number[]) => numbers.map((queueNumber) => ({ queueNumber }));

    beforeEach(() => {
      ceremonyRepo.findOne.mockResolvedValue(jigai({ morningCapacity: 3 }));
    });

    it("沒選場次：400", async () => {
      await expect(service.register(dto({ session: undefined }) as never, "u1")).rejects.toThrow("請選擇上午場或下午場");
    });

    it("取該場最小的空號並存進報名紀錄", async () => {
      registrationRepo.find.mockResolvedValue(used(1, 3));
      const result = await service.register(dto() as never, "u1");
      expect(result.registration).toMatchObject({ session: CeremonySession.AM, queueNumber: 2 });
      expect(registrationRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { ceremonyId: "c1", session: CeremonySession.AM } }));
    });

    it("號碼欄位是 null 的舊資料不算佔號", async () => {
      registrationRepo.find.mockResolvedValue([{ queueNumber: null }, { queueNumber: 1 }]);
      const result = await service.register(dto() as never, "u1");
      expect(result.registration.queueNumber).toBe(2);
    });

    it("額滿：409，訊息帶出場次與上限", async () => {
      registrationRepo.find.mockResolvedValue(used(1, 2, 3));
      await expect(service.register(dto() as never, "u1")).rejects.toThrow(new ConflictException("上午場已額滿（上限 3 人）"));
      expect(registrationRepo.save).not.toHaveBeenCalled();
    });

    it("撞號（別的櫃台同時拿到同一個號碼）：重新查一次空號再存", async () => {
      registrationRepo.find.mockResolvedValueOnce(used()).mockResolvedValueOnce(used(1));
      registrationRepo.save.mockRejectedValueOnce(uniqueViolation());
      const result = await service.register(dto() as never, "u1");
      expect(result.registration.queueNumber).toBe(2);
      expect(registrationRepo.find).toHaveBeenCalledTimes(2);
    });

    it("連續撞號 5 次：放棄並回 409 請使用者重送，不會無限重試", async () => {
      registrationRepo.find.mockResolvedValue(used());
      registrationRepo.save.mockRejectedValue(uniqueViolation());
      await expect(service.register(dto() as never, "u1")).rejects.toThrow("報名人數眾多，取號失敗，請重新送出");
      expect(registrationRepo.save).toHaveBeenCalledTimes(5);
    });

    it("重試途中變成額滿：回報額滿", async () => {
      registrationRepo.find.mockResolvedValueOnce(used(1, 2)).mockResolvedValueOnce(used(1, 2, 3));
      registrationRepo.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.register(dto() as never, "u1")).rejects.toThrow("上午場已額滿");
    });

    it("其他資料庫錯誤不重試，原樣往外丟", async () => {
      const dbError = otherDbError();
      registrationRepo.save.mockRejectedValue(dbError);
      await expect(service.register(dto() as never, "u1")).rejects.toBe(dbError);
      expect(registrationRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe("祭改整戶報名", () => {
    const members = [
      { id: MEMBER_A, name: "李大" },
      { id: MEMBER_B, name: "李二" },
    ];
    const dto = (overrides: object = {}) => ({ ceremonyId: "c1", householdId: "h1", amount: 600, session: CeremonySession.PM, ...overrides });

    beforeEach(() => {
      ceremonyRepo.findOne.mockResolvedValue(jigai({ afternoonCapacity: 3 }));
      householdService.findMembersByHouseholdId.mockResolvedValue(members);
    });

    it("沒選場次：400", async () => {
      await expect(service.createRegistrationForCombined(dto({ session: undefined }) as never, "u1")).rejects.toThrow("請選擇上午場或下午場");
    });

    it("每人依序拿空號（跳過已被佔用的），金額平均分攤，備註列出每個人的號碼", async () => {
      registrationRepo.find.mockResolvedValue([{ queueNumber: 1 }]);
      const result = await service.createRegistrationForCombined(dto() as never, "u1");
      expect(result).toMatchObject({ payerName: "李大、李二", description: "祭改*2人", note: "下午場｜李大 2號、李二 3號", templeId: "t1" });
      const saved = registrationRepo.txManager.save.mock.calls.map(([row]) => row);
      expect(saved.map((r: any) => [r.memberId, r.queueNumber, r.amount])).toEqual([
        [MEMBER_A, 2, "300.00"],
        [MEMBER_B, 3, "300.00"],
      ]);
    });

    it("剩餘名額比人數少：409，訊息帶出人數與剩餘名額，不寫入任何資料", async () => {
      registrationRepo.find.mockResolvedValue([{ queueNumber: 1 }, { queueNumber: 2 }]);
      await expect(service.createRegistrationForCombined(dto() as never, "u1")).rejects.toThrow("下午場名額不足（整戶 2 人，剩餘 1 個名額）");
      expect(registrationRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it("交易內撞號：409 請重送；其他錯誤原樣往外丟", async () => {
      registrationRepo.txManager.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.createRegistrationForCombined(dto() as never, "u1")).rejects.toThrow("報名人數眾多，取號失敗，請重新送出");
      const dbError = otherDbError();
      registrationRepo.txManager.save.mockRejectedValueOnce(dbError);
      await expect(service.createRegistrationForCombined(dto() as never, "u1")).rejects.toBe(dbError);
    });
  });

  // ───────────────────────────── 合併報名的分流 ─────────────────────────────
  describe("createRegistrationForCombined：依請求內容分流到不同的報名方式", () => {
    it("活動不存在：404", async () => {
      await expect(service.createRegistrationForCombined({ ceremonyId: "c1", amount: 0 } as never, "u1")).rejects.toThrow(
        new NotFoundException("找不到活動"),
      );
    });

    it("有 householdId → 整戶報名（優先於其他欄位）", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      const spy = jest.spyOn(internals, "createHouseholdRegistrationForCombined").mockResolvedValue({ registrations: [] });
      await service.createRegistrationForCombined({ ceremonyId: "c1", householdId: "h1", tableNumber: 1, amount: 0 } as never, "u1");
      expect(spy).toHaveBeenCalled();
    });

    it("進香活動 → 進香報名；進香帶 householdId 或 tableNumber：400", async () => {
      ceremonyRepo.findOne.mockResolvedValue(pilgrimage());
      const spy = jest.spyOn(internals, "createPilgrimageRegistrationForCombined").mockResolvedValue({ registrations: [] });
      await service.createRegistrationForCombined({ ceremonyId: "c1", walkInName: "甲", amount: 0 } as never, "u1");
      expect(spy).toHaveBeenCalledTimes(1);

      for (const extra of [{ householdId: "h1" }, { tableNumber: 1 }]) {
        await expect(
          service.createRegistrationForCombined({ ceremonyId: "c1", walkInName: "甲", amount: 0, ...extra } as never, "u1"),
        ).rejects.toThrow(new BadRequestException("進香請逐一登錄參加者，不能整戶或認領整桌報名"));
      }
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("有 tableNumber → 認領整桌", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      const spy = jest.spyOn(internals, "createTableRegistrationForCombined").mockResolvedValue({ registration: {} });
      await service.createRegistrationForCombined({ ceremonyId: "c1", tableNumber: 1, amount: 0 } as never, "u1");
      expect(spy).toHaveBeenCalled();
    });

    it("都沒有 → 單人報名，回傳內容帶收據要印的姓名、項目與備註", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      registrationRepo.findOne.mockResolvedValue({ id: "reg1", ceremonyId: "c1", walkInName: "甲", seatNumber: "1-2", queueNumber: null });
      const result = await service.createRegistrationForCombined({ ceremonyId: "c1", walkInName: "甲", amount: 100, seatIndex: 2 } as never, "u1");
      expect(result).toMatchObject({ payerName: "甲", description: "中元普渡", note: "座位：1桌2號", templeId: "t1" });
    });
  });

  // ───────────────────────────── 整戶／整桌 ─────────────────────────────
  describe("整戶報名（一般活動）", () => {
    const members = [
      { id: MEMBER_A, name: "陳一" },
      { id: MEMBER_B, name: "陳二" },
    ];
    const dto = (overrides: object = {}) => ({ ceremonyId: "c1", householdId: "h1", amount: 1000, ...overrides });

    it("活動不存在 404；戶內沒有信徒 400", async () => {
      await expect(service.createRegistrationForCombined(dto() as never, "u1")).rejects.toThrow("找不到活動");
      ceremonyRepo.findOne.mockResolvedValue(general());
      await expect(service.createRegistrationForCombined(dto() as never, "u1")).rejects.toThrow("此戶籍沒有信徒資料，無法整戶報名");
    });

    it("一般活動不選位也可以：沒有備註，每人不帶座位", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      householdService.findMembersByHouseholdId.mockResolvedValue(members);
      const result = await service.createRegistrationForCombined(dto() as never, "u1");
      expect(result).toMatchObject({ description: "中元普渡*2人", payerName: "陳一、陳二" });
      expect(result.note).toBeUndefined();
      expect(registrationRepo.txManager.save.mock.calls.every(([row]: any) => row.seatIndex === undefined)).toBe(true);
    });

    it.each([
      ["選位數量與人數不符", { householdSeatIndexes: [1] }, general(), "選位數量與戶籍人數不符，請重新選位"],
      ["活動沒設座位", { householdSeatIndexes: [1, 2] }, general({ tableCount: null }), "此活動未設定座位"],
      ["座位超出範圍", { householdSeatIndexes: [1, 7] }, general(), "座位超出範圍"],
    ])("%s：400", async (_label, overrides, ceremony, message) => {
      ceremonyRepo.findOne.mockResolvedValue(ceremony);
      householdService.findMembersByHouseholdId.mockResolvedValue(members);
      await expect(service.createRegistrationForCombined(dto(overrides) as never, "u1")).rejects.toThrow(new BadRequestException(message));
      expect(registrationRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it("一般活動整戶選位：座位依序對應每個人，備註列出座位", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      householdService.findMembersByHouseholdId.mockResolvedValue(members);
      const result = await service.createRegistrationForCombined(dto({ householdSeatIndexes: [4, 5] }) as never, "u1");
      expect(result.note).toBe("座位｜2桌1號、2桌2號");
      const saved = registrationRepo.txManager.save.mock.calls.map(([row]: any) => [row.memberId, row.seatIndex, row.seatNumber, row.amount]);
      expect(saved).toEqual([
        [MEMBER_A, 4, "2-1", "500.00"],
        [MEMBER_B, 5, "2-2", "500.00"],
      ]);
    });

    it("其中一個座位被選走：409；其他錯誤原樣往外丟", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      householdService.findMembersByHouseholdId.mockResolvedValue(members);
      registrationRepo.txManager.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.createRegistrationForCombined(dto({ householdSeatIndexes: [1, 2] }) as never, "u1")).rejects.toThrow("其中有座位已被選走，請重新選擇");
      const dbError = otherDbError();
      registrationRepo.txManager.save.mockRejectedValueOnce(dbError);
      await expect(service.createRegistrationForCombined(dto({ householdSeatIndexes: [1, 2] }) as never, "u1")).rejects.toBe(dbError);
    });
  });

  describe("認領整桌", () => {
    const dto = (overrides: object = {}) => ({ ceremonyId: "c1", memberId: MEMBER_A, amount: 3000, tableNumber: 2, ...overrides });

    it.each([
      ["活動不存在", null, {}, "找不到活動"],
      ["活動沒設座位", general({ tableCount: null }), {}, "此活動未設定座位"],
      ["祭改活動", jigai(), {}, "此活動未設定座位"],
      ["進香活動", pilgrimage(), {}, "進香請逐一登錄參加者，不能整戶或認領整桌報名"],
      ["桌號 0", general(), { tableNumber: 0 }, "桌號超出範圍"],
      ["桌號超過桌數", general(), { tableNumber: 3 }, "桌號超出範圍"],
    ])("%s：擋下", async (_label, ceremony, overrides, message) => {
      ceremonyRepo.findOne.mockResolvedValue(ceremony);
      await expect(service.createRegistrationForCombined(dto(overrides) as never, "u1")).rejects.toThrow(message);
    });

    it("整桌每個座位各一筆：只有第一個座位掛報名者與金額，其餘是佔位（金額 0、姓名供座位圖顯示）", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      const result = await service.createRegistrationForCombined(dto() as never, "u1");
      expect(result).toMatchObject({ payerName: "王小明", description: "中元普渡", note: "第2桌" });
      const saved = registrationRepo.txManager.save.mock.calls.map(([row]: any) => [row.seatIndex, row.memberId, row.walkInName, row.amount]);
      expect(saved).toEqual([
        [4, MEMBER_A, null, "3000.00"],
        [5, null, "王小明", "0.00"],
        [6, null, "王小明", "0.00"],
      ]);
    });

    it("臨櫃認領整桌：姓名用填的，佔位座位也帶同一個姓名", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      await service.createRegistrationForCombined(dto({ memberId: undefined, walkInName: "林老闆" }) as never, "u1");
      expect(registrationRepo.txManager.save.mock.calls[0][0]).toMatchObject({ memberId: null, walkInName: "林老闆" });
      expect(registrationRepo.txManager.save.mock.calls[1][0].walkInName).toBe("林老闆");
      expect(householdService.findMemberById).not.toHaveBeenCalled();
    });

    it("認領整桌沒有信徒也沒有姓名（或只有空白）：400，不佔任何座位", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      for (const walkInName of [undefined, "", "   "]) {
        await expect(
          service.createRegistrationForCombined(dto({ memberId: undefined, walkInName }) as never, "u1"),
        ).rejects.toThrow("請選擇信徒或填寫報名者姓名");
      }
      expect(registrationRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it("該桌有座位已被選走：409；其他錯誤原樣往外丟", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      registrationRepo.txManager.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.createRegistrationForCombined(dto() as never, "u1")).rejects.toThrow("此桌已有座位被選走，請重新選擇");
      const dbError = otherDbError();
      registrationRepo.txManager.save.mockRejectedValueOnce(dbError);
      await expect(service.createRegistrationForCombined(dto() as never, "u1")).rejects.toBe(dbError);
    });
  });

  // ───────────────────────────── 進香 ─────────────────────────────
  describe("進香報名（createPilgrimageRegistrationForCombined）", () => {
    const dto = (overrides: object = {}) => ({
      ceremonyId: "c1",
      walkInName: "阿土伯",
      roomType: "雙人房",
      amount: 3000,
      passengerMemberIds: ["", ""],
      passengerNames: ["", "阿土嫂"],
      ...overrides,
    });
    const memberMap = () =>
      new Map([
        [MEMBER_A, { id: MEMBER_A, name: "王小明" }],
        [MEMBER_B, { id: MEMBER_B, name: "李大華" }],
      ]);
    const register = (overrides: object = {}, ceremony: object = pilgrimage()) =>
      internals.createPilgrimageRegistrationForCombined(dto(overrides), ceremony, "u1");
    const savedRows = () => registrationRepo.txManager.save.mock.calls.map(([row]: any) => row);

    beforeEach(() => {
      householdService.findMembersByIds.mockResolvedValue(memberMap());
      // 交易內鎖住活動那一列：預設查得到
      registrationRepo.txManager.findOne.mockResolvedValue(pilgrimage());
    });

    it.each([
      ["沒有信徒也沒有姓名", { walkInName: "  " }, "請選擇信徒或填寫報名者姓名"],
      ["沒選房型", { roomType: undefined }, "請選擇房型"],
      ["房型不存在", { roomType: "豪華房" }, "請選擇房型"],
      ["人數超過每間上限", { passengerMemberIds: ["", "", ""], passengerNames: ["", "乙", "丙"] }, "雙人房每間最多 2 人，目前登錄 3 人"],
      ["金額不是房型費用", { amount: 1500 }, "雙人房費用為 NT$ 3000"],
      ["信徒 id 格式不對", { passengerMemberIds: ["", "abc"] }, "信徒資料錯誤，請重新選擇"],
      ["同行者跟報名者是同一個信徒", { memberId: MEMBER_A, passengerMemberIds: ["", MEMBER_A] }, "同一位信徒不能重複報名，請檢查參加者名單"],
    ])("%s：400，不開交易、不寫入資料", async (_label, overrides, message) => {
      await expect(register(overrides)).rejects.toThrow(new BadRequestException(message));
      expect(registrationRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it("活動已過報名期限：400", async () => {
      await expect(register({}, pilgrimage({ date: "2000-01-01" }))).rejects.toThrow("此活動已過報名期限，無法報名");
    });

    it("信徒 id 格式正確但查不到人：404", async () => {
      householdService.findMembersByIds.mockResolvedValue(new Map());
      await expect(register({ passengerMemberIds: ["", MEMBER_B] })).rejects.toThrow(new NotFoundException("找不到信徒"));
    });

    it("報名者是信徒、同行有信徒也有臨櫃：各自記在正確的欄位，金額只掛在第一筆，同一間房", async () => {
      const ceremony = pilgrimage({ roomTypes: [{ name: "四人房", capacity: 4, fee: 5200, roomCount: 1 }] });
      registrationRepo.txManager.findOne.mockResolvedValue(ceremony);
      const result = await register(
        {
          walkInName: undefined,
          memberId: MEMBER_A,
          roomType: "四人房",
          amount: 5200,
          passengerMemberIds: ["", MEMBER_B, ""],
          passengerNames: ["", "", "  陳小美  "],
          wishText: "平安",
        },
        ceremony,
      );
      expect(savedRows().map((r: any) => [r.memberId, r.walkInName, r.amount, r.wishText, r.roomType, r.roomNumber, r.seatIndex])).toEqual([
        [MEMBER_A, null, "5200.00", "平安", "四人房", 1, undefined],
        [MEMBER_B, null, "0.00", null, "四人房", 1, undefined],
        [null, "陳小美", "0.00", null, "四人房", 1, undefined],
      ]);
      expect(result).toMatchObject({
        payerName: "王小明",
        description: "進香*3人",
        note: "四人房｜王小明、李大華、陳小美",
        templeId: "t1",
      });
    });

    it("雙人房只住 1 人：項目不加「*n人」，備註只印房型", async () => {
      const result = await register({ passengerMemberIds: undefined, passengerNames: undefined });
      expect(savedRows()).toHaveLength(1);
      expect(result).toMatchObject({ description: "進香", note: "雙人房" });
    });

    it("臨櫃同行者沒填姓名（或只填空白）：沿用報名者姓名", async () => {
      const result = await register({ passengerNames: ["", "   "] });
      expect(savedRows()[1]).toMatchObject({ memberId: null, walkInName: "阿土伯" });
      expect(result.note).toBe("雙人房｜阿土伯、阿土伯");
    });

    it("第一位的 passengerMemberIds／passengerNames 會被忽略（第一位一定是報名者本人）", async () => {
      await register({ memberId: MEMBER_A, walkInName: undefined, passengerMemberIds: [MEMBER_B, ""], passengerNames: ["別人", ""] });
      expect(savedRows()[0]).toMatchObject({ memberId: MEMBER_A });
    });

    it("先鎖住活動再計算；鎖的時候活動已被刪除：404", async () => {
      await register();
      expect(registrationRepo.txManager.findOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ where: { id: "c1" }, lock: { mode: "pessimistic_write" } }),
      );
      registrationRepo.txManager.findOne.mockResolvedValue(null);
      await expect(register()).rejects.toThrow(new NotFoundException("找不到活動"));
    });

    it("房號：配給最小的空房號；訂滿 409；間數不限就一直往後配", async () => {
      registrationRepo.txQb.getRawMany.mockResolvedValueOnce([{ roomType: "雙人房", roomNumber: 1, occupants: "2" }]);
      await register();
      expect(savedRows()[0].roomNumber).toBe(2);

      registrationRepo.txQb.getRawMany.mockResolvedValueOnce([
        { roomType: "雙人房", roomNumber: 1, occupants: "2" },
        { roomType: "雙人房", roomNumber: 2, occupants: "1" },
      ]);
      await expect(register()).rejects.toThrow(new ConflictException("雙人房已訂滿（共 2 間）"));

      const unlimited = pilgrimage({ roomTypes: [{ ...DOUBLE_ROOM, roomCount: null }] });
      registrationRepo.txQb.getRawMany.mockResolvedValueOnce([
        { roomType: "雙人房", roomNumber: 1, occupants: "2" },
        { roomType: "雙人房", roomNumber: 2, occupants: "2" },
      ]);
      registrationRepo.txManager.save.mockClear();
      await register({}, unlimited);
      expect(savedRows()[0].roomNumber).toBe(3);
    });

    it("其他房型的房號不影響這個房型", async () => {
      registrationRepo.txQb.getRawMany.mockResolvedValueOnce([{ roomType: "四人房", roomNumber: 1, occupants: "4" }]);
      await register();
      expect(savedRows()[0].roomNumber).toBe(1);
    });

    it("遊覽車：已報名人數 + 這次人數超過可載人數 409；剛好坐滿可以；沒設台數不檢查", async () => {
      registrationRepo.txManager.count.mockResolvedValue(39);
      await expect(register()).rejects.toThrow(new ConflictException("遊覽車座位不足：1 台共 40 位，已報名 39 位，剩 1 位"));
      await register({ passengerMemberIds: undefined, passengerNames: undefined });
      expect(savedRows()).toHaveLength(1);

      registrationRepo.txManager.count.mockClear();
      registrationRepo.txManager.findOne.mockResolvedValue(pilgrimage({ busCount: null }));
      await register({}, pilgrimage({ busCount: null }));
      expect(registrationRepo.txManager.count).not.toHaveBeenCalled();
    });

    it("沒有房型的舊活動：不選房型、不配房號，固定金額依人數計算，多人備註列出參加者", async () => {
      const legacy = pilgrimage({ roomTypes: null, feeMode: CeremonyFeeMode.FIXED_AMOUNT, fixedAmount: "800.00" });
      registrationRepo.txManager.findOne.mockResolvedValue(legacy);
      await expect(register({ roomType: undefined, amount: 800 }, legacy)).rejects.toThrow("此活動為固定金額，2 人應收 NT$ 1600");
      const result = await register({ roomType: undefined, amount: 1600 }, legacy);
      expect(result.note).toBe("參加者｜阿土伯、阿土嫂");
      expect(savedRows().every((r: any) => r.roomType === null && r.roomNumber === null)).toBe(true);
      expect(registrationRepo.txQb.getRawMany).not.toHaveBeenCalled();

      const single = await register({ roomType: undefined, amount: 800, passengerMemberIds: undefined, passengerNames: undefined }, legacy);
      expect(single.note).toBeUndefined();
    });

    it("進香不能走單筆報名：400；一般與祭改單人報名沒有姓名也是 400", async () => {
      ceremonyRepo.findOne.mockResolvedValue(pilgrimage());
      await expect(service.register({ ceremonyId: "c1", amount: 1, walkInName: "甲" } as never, "u1")).rejects.toThrow(
        "進香請在活動報名頁登錄參加者並選擇房型後送出",
      );
      ceremonyRepo.findOne.mockResolvedValue(general());
      await expect(service.register({ ceremonyId: "c1", amount: 1 } as never, "u1")).rejects.toThrow("請選擇信徒或填寫報名者姓名");
      ceremonyRepo.findOne.mockResolvedValue(jigai());
      await expect(
        service.register({ ceremonyId: "c1", amount: 1, walkInName: " ", session: CeremonySession.AM } as never, "u1"),
      ).rejects.toThrow("請選擇信徒或填寫報名者姓名");
    });

    it("資料庫錯誤原樣往外丟，不會被當成名額已滿", async () => {
      const dbError = otherDbError();
      registrationRepo.txManager.save.mockRejectedValueOnce(dbError);
      await expect(register()).rejects.toBe(dbError);
    });
  });

  // ───────────────────────────── 座位圖／收據說明／報表 ─────────────────────────────
  describe("getSeatMap", () => {
    it("活動不存在 404；一般活動沒設座位回傳空陣列", async () => {
      await expect(service.getSeatMap("x")).rejects.toThrow(NotFoundException);
      ceremonyRepo.findOne.mockResolvedValue(general({ seatsPerTable: null }));
      expect(await service.getSeatMap("c1")).toEqual([]);
    });

    it("一般活動：每個座位標出桌號、位號與狀態；信徒顯示姓名、臨櫃顯示填的姓名；已作廢的不算", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general({ tableCount: 1, seatsPerTable: 4 }));
      registrationRepo.find.mockResolvedValue([
        { id: "a", seatIndex: 1, memberId: MEMBER_A, walkInName: null },
        { id: "b", seatIndex: 2, memberId: null, walkInName: "臨櫃" },
        { id: "c", seatIndex: 3, memberId: null, walkInName: "已作廢" },
        { id: "d", seatIndex: null, memberId: null, walkInName: "沒座位" },
        { id: "e", seatIndex: 4, memberId: MEMBER_B, walkInName: null },
      ]);
      lanternService.getVoidedSourceIds.mockResolvedValue(new Set(["c"]));
      householdService.findMembersByIds.mockResolvedValue(new Map([[MEMBER_A, { name: "王小明" }]]));

      const seats = await service.getSeatMap("c1");
      expect(seats).toEqual([
        { seatIndex: 1, tableNumber: 1, seatInTable: 1, status: "TAKEN", participantName: "王小明" },
        { seatIndex: 2, tableNumber: 1, seatInTable: 2, status: "TAKEN", participantName: "臨櫃" },
        { seatIndex: 3, tableNumber: 1, seatInTable: 3, status: "EMPTY", participantName: undefined },
        // 信徒已被刪除（查不到）→ 仍然是已入座，姓名空白
        { seatIndex: 4, tableNumber: 1, seatInTable: 4, status: "TAKEN", participantName: "" },
      ]);
    });

    it("進香、祭改不選座位：回傳空陣列", async () => {
      ceremonyRepo.findOne.mockResolvedValue(pilgrimage());
      expect(await service.getSeatMap("c1")).toEqual([]);
      ceremonyRepo.findOne.mockResolvedValue(jigai());
      expect(await service.getSeatMap("c1")).toEqual([]);
    });
  });

  describe("describeRegistration：收據上的姓名、項目與備註", () => {
    const describeWith = async (registration: object | null, ceremony: object | null = general()) => {
      registrationRepo.findOne.mockResolvedValue(registration);
      ceremonyRepo.findOne.mockResolvedValue(ceremony);
      return service.describeRegistration("reg1");
    };

    it("報名紀錄不存在（例如已刪除）：回傳空白，不拋錯", async () => {
      expect(await describeWith(null)).toEqual({ payerName: "", description: "" });
    });

    it("祭改：備註是場次與號碼（優先於座位）", async () => {
      const result = await describeWith({ ceremonyId: "c1", walkInName: "甲", queueNumber: 3, session: CeremonySession.AM, seatNumber: "1-1" }, jigai());
      expect(result).toEqual({ payerName: "甲", description: "祭改", note: "甲，上午場 3號" });
    });

    it("進香：備註印房型；改版前選遊覽車座位的舊資料用「排」；一般活動用「桌」；沒有座位就沒有備註", async () => {
      expect((await describeWith({ ceremonyId: "c1", walkInName: "甲", roomType: "雙人房", roomNumber: 2 }, pilgrimage())).note).toBe("雙人房");
      expect((await describeWith({ ceremonyId: "c1", walkInName: "甲", seatNumber: "3-2" }, pilgrimage())).note).toBe("座位：3排2號");
      expect((await describeWith({ ceremonyId: "c1", walkInName: "甲", seatNumber: "3-2" })).note).toBe("座位：3桌2號");
      expect((await describeWith({ ceremonyId: "c1", walkInName: "甲", seatNumber: null })).note).toBeUndefined();
    });

    it("信徒：姓名從信徒資料來；信徒已刪除時姓名空白；活動已刪除時項目空白", async () => {
      expect((await describeWith({ ceremonyId: "c1", memberId: MEMBER_A })).payerName).toBe("王小明");
      householdService.findMemberByIdOrNull.mockResolvedValue(null);
      expect((await describeWith({ ceremonyId: "c1", memberId: MEMBER_A })).payerName).toBe("");
      expect(await describeWith({ ceremonyId: "c1", walkInName: null, seatNumber: "1-1" }, null)).toEqual({
        payerName: "",
        description: "",
        note: "座位：1桌1號",
      });
    });
  });

  describe("findHistoryByMemberId / cancelRegistration / getCeremonyReport", () => {
    it("信徒沒有任何報名：直接回傳空陣列", async () => {
      expect(await service.findHistoryByMemberId(MEMBER_A)).toEqual([]);
      expect(ceremonyRepo.findByIds).not.toHaveBeenCalled();
    });

    it("歷史紀錄帶活動名稱；活動已刪除時名稱留空", async () => {
      const createdAt = new Date("2026-03-01T00:00:00Z");
      registrationRepo.find.mockResolvedValue([
        { id: "r1", ceremonyId: "c1", amount: "500.00", createdAt },
        { id: "r2", ceremonyId: "gone", amount: "0.00", createdAt },
      ]);
      ceremonyRepo.findByIds.mockResolvedValue([{ id: "c1", name: "進香" }]);
      const history = await service.findHistoryByMemberId(MEMBER_A);
      expect(history).toEqual([
        { type: "DONATION", id: "r1", description: "活動報名（進香）", amount: 500, occurredAt: createdAt.toISOString() },
        { type: "DONATION", id: "r2", description: "活動報名（）", amount: 0, occurredAt: createdAt.toISOString() },
      ]);
    });

    it("取消報名：找不到 404；找到就刪除", async () => {
      await expect(service.cancelRegistration("x")).rejects.toThrow("找不到報名紀錄");
      registrationRepo.findOne.mockResolvedValue({ id: "reg1" });
      await service.cancelRegistration("reg1");
      expect(registrationRepo.remove).toHaveBeenCalledWith({ id: "reg1" });
    });

    it("報表：排除已作廢的報名，加總金額、座位數、活動捐款與已核准支出", async () => {
      await expect(service.getCeremonyReport("x")).rejects.toThrow(NotFoundException);

      ceremonyRepo.findOne.mockResolvedValue(general());
      const createdAt = new Date("2026-03-01T00:00:00Z");
      registrationRepo.find.mockResolvedValue([
        { id: "a", ceremonyId: "c1", walkInName: "甲", amount: "700.00", seatIndex: 1, seatNumber: "1-1", createdAt },
        { id: "b", ceremonyId: "c1", walkInName: "乙", amount: "300.00", seatIndex: 2, seatNumber: "1-2", createdAt },
        { id: "c", ceremonyId: "c1", walkInName: "丙", amount: "100.00", seatIndex: null, seatNumber: null, createdAt },
      ]);
      lanternService.getVoidedSourceIds.mockResolvedValue(new Set(["b"]));
      lanternService.getReceiptIdsBySource.mockResolvedValue(new Map([["a", "receipt-a"]]));
      lanternService.getCeremonyDonationSummary.mockResolvedValue({ total: 5000, items: [{ payerName: "善心", amount: 5000 }] });
      ledgerRepo.find.mockResolvedValue([
        { category: "供品", amount: "800.00", description: null, occurredAt: "2026-03-01" },
        { category: "場地", amount: "200.00", description: "租金", occurredAt: "2026-03-02" },
      ]);

      const report = await service.getCeremonyReport("c1");
      expect(report).toMatchObject({ totalAmount: 800, registrationCount: 2, donationTotal: 5000, expenseTotal: 1000 });
      expect(report.ceremony).toMatchObject({ registrationCount: 2, totalAmount: 800, seatsAssigned: 1 });
      expect(report.registrations.map((r) => [r.participantName, r.receiptId])).toEqual([
        ["甲", "receipt-a"],
        ["丙", null],
      ]);
      expect(report.expenses).toEqual([
        { category: "供品", amount: 800, description: null, occurredAt: "2026-03-01" },
        { category: "場地", amount: 200, description: "租金", occurredAt: "2026-03-02" },
      ]);
    });

    it("報名明細的地址：信徒用戶籍模組查到的地址，臨櫃用填的地址", async () => {
      ceremonyRepo.findOne.mockResolvedValue(general());
      householdService.findHouseholdAddressByMemberId.mockResolvedValue("嘉義縣");
      registrationRepo.find.mockResolvedValue([
        { id: "a", ceremonyId: "c1", memberId: MEMBER_A, amount: "0.00", createdAt: new Date() },
        { id: "b", ceremonyId: "c1", walkInName: "乙", walkInAddress: "台南市", amount: "0.00", createdAt: new Date() },
        { id: "c", ceremonyId: "c1", walkInName: "丙", amount: "0.00", createdAt: new Date() },
      ]);
      const report = await service.getCeremonyReport("c1");
      expect(report.registrations.map((r) => r.participantAddress)).toEqual(["嘉義縣", "台南市", null]);
    });
  });
});
