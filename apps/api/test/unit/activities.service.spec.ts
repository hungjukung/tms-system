import { BadRequestException, ConflictException } from "@nestjs/common";
import { ReceiptSourceType, UserRole } from "@tms/shared";
import { ActivitiesService } from "../../src/activities/activities.service";

/**
 * 白箱單元測試：ActivitiesService.submit（活動報名頁的合併送出）。
 * 重點是三段內部邏輯：付款人／廟宇的決定順序、多人點燈時備註加姓名、失敗時的回滾。
 */
describe("ActivitiesService.submit（白箱）", () => {
  let lantern: Record<string, jest.Mock>;
  let ceremony: Record<string, jest.Mock>;
  let gift: Record<string, jest.Mock>;
  let service: ActivitiesService;

  const claimResult = (claimId: string, payerName: string, note?: string) => ({
    slot: {},
    claimId,
    payerName,
    description: "右牆",
    note,
    templeId: "t1",
  });

  beforeEach(() => {
    lantern = {
      claimSlotForCombined: jest.fn(),
      claimSlotsForHouseholdCombined: jest.fn(),
      createDonationForCombined: jest.fn(),
      issueCombinedReceipt: jest.fn(async (items, payerName, _userId, templeId) => ({ id: "r1", items, payerName, templeId })),
      cancelClaim: jest.fn().mockResolvedValue(undefined),
    };
    ceremony = {
      createRegistrationForCombined: jest.fn(),
      cancelRegistration: jest.fn().mockResolvedValue(undefined),
    };
    gift = { createGiftForCombined: jest.fn() };
    service = new ActivitiesService(lantern as never, ceremony as never, gift as never);
  });

  const submit = (dto: object) => service.submit(dto as never, "u1", UserRole.VOLUNTEER);
  const issuedItems = () => lantern.issueCombinedReceipt.mock.calls[0][0] as { note?: string; description: string; amount: number }[];

  it("完全沒有項目：400，不開收據", async () => {
    await expect(submit({})).rejects.toThrow(new BadRequestException("尚未填寫任何活動項目"));
    await expect(submit({ pendingLanternClaims: [], pendingCeremonyRegistrations: [] })).rejects.toThrow(BadRequestException);
    expect(lantern.issueCombinedReceipt).not.toHaveBeenCalled();
  });

  describe("點燈備註加姓名的規則", () => {
    it("只有一個人點燈（即使點很多盞）：不加姓名", async () => {
      lantern.claimSlotForCombined
        .mockResolvedValueOnce(claimResult("c1", "龔忠欣", "燈位：A-01"))
        .mockResolvedValueOnce(claimResult("c2", "龔忠欣", "燈位：A-02"));
      await submit({ pendingLanternClaims: [{ amount: 600 }, { amount: 600 }] });
      expect(issuedItems().map((i) => i.note)).toEqual(["燈位：A-01", "燈位：A-02"]);
    });

    it("兩個不同的人點燈：每一筆前面都加上姓名", async () => {
      lantern.claimSlotForCombined
        .mockResolvedValueOnce(claimResult("c1", "王小明", "燈位：A-01"))
        .mockResolvedValueOnce(claimResult("c2", "李大華", "燈位：A-02"));
      await submit({ pendingLanternClaims: [{ amount: 600 }, { amount: 600 }] });
      expect(issuedItems().map((i) => i.note)).toEqual(["王小明，燈位：A-01", "李大華，燈位：A-02"]);
    });

    it("單人點燈與整戶點燈的付款人不同：兩邊都加姓名", async () => {
      lantern.claimSlotForCombined.mockResolvedValueOnce(claimResult("c1", "王小明", "燈位：A-01"));
      lantern.claimSlotsForHouseholdCombined.mockResolvedValueOnce({
        payerName: "陳一、陳二",
        description: "點燈*2人",
        note: "燈位｜B-01、B-02",
        templeId: "t1",
        claimIds: ["c2", "c3"],
      });
      await submit({ pendingLanternClaims: [{ amount: 600 }], pendingHouseholdLanternClaims: [{ amount: 1200 }] });
      expect(issuedItems().map((i) => i.note)).toEqual(["王小明，燈位：A-01", "陳一、陳二，燈位｜B-01、B-02"]);
    });

    it("其中一筆沒有姓名或沒有備註：那一筆維持原樣，不會變成「，燈位…」或「姓名，undefined」", async () => {
      lantern.claimSlotForCombined
        .mockResolvedValueOnce(claimResult("c1", "", "燈位：A-01"))
        .mockResolvedValueOnce(claimResult("c2", "李大華", undefined))
        .mockResolvedValueOnce(claimResult("c3", "王小明", "燈位：A-03"));
      await submit({ pendingLanternClaims: [{ amount: 1 }, { amount: 1 }, { amount: 1 }] });
      expect(issuedItems().map((i) => i.note)).toEqual(["燈位：A-01", undefined, "王小明，燈位：A-03"]);
    });

    it("活動報名、捐款的備註不受影響（只有點燈項目會加姓名）", async () => {
      lantern.claimSlotForCombined
        .mockResolvedValueOnce(claimResult("c1", "王小明", "燈位：A-01"))
        .mockResolvedValueOnce(claimResult("c2", "李大華", "燈位：A-02"));
      ceremony.createRegistrationForCombined.mockResolvedValue({
        registration: { id: "reg1" },
        payerName: "王小明",
        description: "法會",
        note: "座位：1桌1號",
        templeId: "t1",
      });
      await submit({ pendingLanternClaims: [{ amount: 1 }, { amount: 1 }], pendingCeremonyRegistrations: [{ amount: 1 }] });
      expect(issuedItems()[2].note).toBe("座位：1桌1號");
    });
  });

  describe("付款人與廟宇的決定順序", () => {
    it("以第一個有姓名的項目為準（點燈 → 活動 → 捐款 → 送禮）", async () => {
      lantern.claimSlotForCombined.mockResolvedValue(claimResult("c1", "", "x"));
      ceremony.createRegistrationForCombined.mockResolvedValue({ registration: { id: "reg1" }, payerName: "活動的人", description: "法會", templeId: "t9" });
      lantern.createDonationForCombined.mockResolvedValue({ donation: { id: "d1" }, payerName: "捐款的人", description: "一般捐款" });
      const result = await submit({
        pendingLanternClaims: [{ amount: 1 }],
        pendingCeremonyRegistrations: [{ amount: 1 }],
        donation: { templeId: "t-donation", amount: 1 },
      });
      // 點燈沒有姓名 → 用活動的；廟宇以最先出現的點燈為準
      expect(result.receipt).toMatchObject({ payerName: "活動的人", templeId: "t1" });
    });

    it("所有項目都沒有姓名：用前端傳來的備用姓名；連備用都沒有就是空字串", async () => {
      lantern.createDonationForCombined.mockResolvedValue({ donation: { id: "d1" }, payerName: "", description: "一般捐款" });
      await submit({ donation: { templeId: "t1", amount: 1 }, fallbackPayerName: "備用姓名" });
      expect(lantern.issueCombinedReceipt.mock.calls[0][1]).toBe("備用姓名");

      lantern.issueCombinedReceipt.mockClear();
      await submit({ donation: { templeId: "t1", amount: 1 } });
      expect(lantern.issueCombinedReceipt.mock.calls[0][1]).toBe("");
    });

    it("只有捐款時廟宇用捐款指定的廟；項目都沒有廟宇時用備用廟宇；完全沒有就 400", async () => {
      lantern.createDonationForCombined.mockResolvedValue({ donation: { id: "d1" }, payerName: "甲", description: "一般捐款" });
      await submit({ donation: { templeId: "t-donation", amount: 1 } });
      expect(lantern.issueCombinedReceipt.mock.calls[0][3]).toBe("t-donation");

      ceremony.createRegistrationForCombined.mockResolvedValue({ registration: { id: "reg1" }, payerName: "甲", description: "法會", templeId: "" });
      lantern.issueCombinedReceipt.mockClear();
      await submit({ pendingCeremonyRegistrations: [{ amount: 1 }], fallbackTempleId: "t-fallback" });
      expect(lantern.issueCombinedReceipt.mock.calls[0][3]).toBe("t-fallback");

      await expect(submit({ pendingCeremonyRegistrations: [{ amount: 1 }] })).rejects.toThrow("無法判斷此次收據所屬廟宇");
    });
  });

  describe("收據項目的內容", () => {
    it("活動報名項目標記分類並記下每一筆報名的來源；送禮金額固定 0", async () => {
      ceremony.createRegistrationForCombined.mockResolvedValue({
        registrations: [{ id: "reg1" }, { id: "reg2" }],
        payerName: "陳一、陳二",
        description: "法會*2人",
        templeId: "t1",
      });
      gift.createGiftForCombined.mockResolvedValue({ gifts: [{ id: "g1" }], payerName: "陳一", description: "送禮", note: "品項：鮮花x1", templeId: "t1" });
      const result = await submit({ pendingCeremonyRegistrations: [{ amount: 1000 }], gift: {} });
      expect(issuedItems()).toEqual([
        {
          description: "法會*2人",
          amount: 1000,
          note: undefined,
          category: "CEREMONY_REGISTRATION",
          sourceRefs: [
            { sourceType: ReceiptSourceType.CEREMONY_REGISTRATION, sourceId: "reg1" },
            { sourceType: ReceiptSourceType.CEREMONY_REGISTRATION, sourceId: "reg2" },
          ],
        },
        { description: "送禮", amount: 0, note: "品項：鮮花x1", sourceRefs: [{ sourceType: ReceiptSourceType.GIFT, sourceId: "g1" }] },
      ]);
      expect(result.ceremonyRegistrations).toHaveLength(2);
      expect(result.gifts).toHaveLength(1);
    });

    it("回傳的 ceremonyRegistration 只帶第一個活動項目的報名紀錄", async () => {
      ceremony.createRegistrationForCombined
        .mockResolvedValueOnce({ registration: { id: "first" }, payerName: "甲", description: "A", templeId: "t1" })
        .mockResolvedValueOnce({ registration: { id: "second" }, payerName: "甲", description: "B", templeId: "t1" });
      const result = await submit({ pendingCeremonyRegistrations: [{ amount: 1 }, { amount: 1 }] });
      expect(result.ceremonyRegistration).toEqual({ id: "first" });
    });

    it("捐款的角色會一路傳給 LanternService（自訂項目的權限在那邊檢查）", async () => {
      lantern.createDonationForCombined.mockResolvedValue({ donation: { id: "d1" }, payerName: "甲", description: "一般捐款" });
      await service.submit({ donation: { templeId: "t1", amount: 1 } } as never, "u1", UserRole.DIRECTOR);
      expect(lantern.createDonationForCombined).toHaveBeenCalledWith({ templeId: "t1", amount: 1 }, "u1", UserRole.DIRECTOR);
    });
  });

  describe("失敗時的回滾", () => {
    it("後面的項目失敗：前面已建立的點燈與活動報名全部取消，原本的錯誤往外丟", async () => {
      lantern.claimSlotForCombined.mockResolvedValueOnce(claimResult("c1", "甲", "x"));
      lantern.claimSlotsForHouseholdCombined.mockResolvedValueOnce({ payerName: "甲", description: "點燈*2人", note: "x", templeId: "t1", claimIds: ["c2", "c3"] });
      ceremony.createRegistrationForCombined
        .mockResolvedValueOnce({ registrations: [{ id: "reg1" }, { id: "reg2" }], payerName: "甲", description: "法會", templeId: "t1" })
        .mockRejectedValueOnce(new ConflictException("此座位已被選走，請重新選擇"));

      await expect(
        submit({
          pendingLanternClaims: [{ amount: 1 }],
          pendingHouseholdLanternClaims: [{ amount: 1 }],
          pendingCeremonyRegistrations: [{ amount: 1 }, { amount: 1 }],
        }),
      ).rejects.toThrow("此座位已被選走，請重新選擇");

      expect(lantern.cancelClaim.mock.calls.map(([id]) => id)).toEqual(["c1", "c2", "c3"]);
      expect(ceremony.cancelRegistration.mock.calls.map(([id]) => id)).toEqual(["reg1", "reg2"]);
      expect(lantern.issueCombinedReceipt).not.toHaveBeenCalled();
    });

    it("開收據那一步失敗也會回滾", async () => {
      lantern.claimSlotForCombined.mockResolvedValueOnce(claimResult("c1", "甲", "x"));
      lantern.issueCombinedReceipt.mockRejectedValue(new Error("資料庫斷線"));
      await expect(submit({ pendingLanternClaims: [{ amount: 1 }] })).rejects.toThrow("資料庫斷線");
      expect(lantern.cancelClaim).toHaveBeenCalledWith("c1");
    });

    it("回滾本身失敗（例如紀錄已經不在）不會蓋掉原本的錯誤訊息", async () => {
      lantern.claimSlotForCombined
        .mockResolvedValueOnce(claimResult("c1", "甲", "x"))
        .mockRejectedValueOnce(new ConflictException("此燈位已被其他櫃台認領"));
      lantern.cancelClaim.mockRejectedValue(new Error("找不到點燈紀錄"));
      await expect(submit({ pendingLanternClaims: [{ amount: 1 }, { amount: 1 }] })).rejects.toThrow("此燈位已被其他櫃台認領");
    });

    it("第一個項目就失敗：沒有東西需要回滾", async () => {
      lantern.claimSlotForCombined.mockRejectedValue(new ConflictException("已被認領"));
      await expect(submit({ pendingLanternClaims: [{ amount: 1 }] })).rejects.toThrow("已被認領");
      expect(lantern.cancelClaim).not.toHaveBeenCalled();
      expect(ceremony.cancelRegistration).not.toHaveBeenCalled();
    });
  });
});
