import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { GiftType, InventoryTransactionType, UserRole } from "@tms/shared";
import { AuthService } from "../../src/auth/auth.service";
import { JwtStrategy } from "../../src/auth/strategies/jwt.strategy";
import { GiftService } from "../../src/gift/gift.service";
import { InventoryService } from "../../src/inventory/inventory.service";
import { PrintService } from "../../src/print/print.service";
import { SettingsService } from "../../src/settings/settings.service";
import { mockRepo, MockRepo, otherDbError, uniqueViolation } from "./support/mocks";

/** 白箱單元測試：帳號、庫存、列印、送禮、設定等較小的 service，逐一走過每個分支 */

describe("AuthService（白箱）", () => {
  let userRepo: MockRepo;
  let jwt: { signAsync: jest.Mock };
  let service: AuthService;
  let passwordHash: string;

  const user = (overrides: object = {}) => ({
    id: "u1",
    username: "director",
    passwordHash,
    displayName: "王總幹事",
    role: UserRole.DIRECTOR,
    active: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  });

  beforeAll(async () => {
    passwordHash = await bcrypt.hash("correct", 4);
  });
  beforeEach(() => {
    userRepo = mockRepo();
    jwt = { signAsync: jest.fn().mockResolvedValue("signed-token") };
    service = new AuthService(userRepo as never, jwt as never);
  });

  describe("login", () => {
    it("帳號不存在：401，而且不會去比對密碼或簽 token", async () => {
      await expect(service.login("nobody", "correct")).rejects.toThrow(new UnauthorizedException("帳號或密碼錯誤"));
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it("帳號已停用：即使密碼正確也是 401", async () => {
      userRepo.findOne.mockResolvedValue(user({ active: false }));
      await expect(service.login("director", "correct")).rejects.toThrow("帳號或密碼錯誤");
    });

    it("密碼錯誤：401", async () => {
      userRepo.findOne.mockResolvedValue(user());
      await expect(service.login("director", "wrong")).rejects.toThrow("帳號或密碼錯誤");
    });

    it("成功：token 內容只有 id、帳號與角色，回傳資料不含密碼雜湊", async () => {
      userRepo.findOne.mockResolvedValue(user());
      const result = await service.login("director", "correct");
      expect(jwt.signAsync).toHaveBeenCalledWith({ sub: "u1", username: "director", role: UserRole.DIRECTOR });
      expect(result).toEqual({
        accessToken: "signed-token",
        user: { id: "u1", username: "director", displayName: "王總幹事", role: UserRole.DIRECTOR },
      });
    });
  });

  describe("createUserAccount", () => {
    const dto = { username: "new", password: "abcd", displayName: "新人", role: UserRole.VOLUNTEER };

    it("密碼存的是雜湊，不是明碼", async () => {
      await service.createUserAccount(dto);
      const created = userRepo.create.mock.calls[0][0] as { passwordHash: string };
      expect(created.passwordHash).not.toBe("abcd");
      expect(await bcrypt.compare("abcd", created.passwordHash)).toBe(true);
    });

    it("帳號重複：409；其他資料庫錯誤原樣往外丟", async () => {
      userRepo.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.createUserAccount(dto)).rejects.toThrow(new ConflictException("此帳號已被使用，請換一個帳號名稱"));
      const dbError = otherDbError();
      userRepo.save.mockRejectedValueOnce(dbError);
      await expect(service.createUserAccount(dto)).rejects.toBe(dbError);
    });
  });

  describe("updateUserAccount", () => {
    it("找不到帳號：404", async () => {
      await expect(service.updateUserAccount("x", {}, "me")).rejects.toThrow(NotFoundException);
    });

    it("改自己：不能換角色、不能停用；角色送一樣的值或 active=true 不算違規", async () => {
      userRepo.findOne.mockImplementation(async () => user());
      await expect(service.updateUserAccount("u1", { role: UserRole.FINANCE }, "u1")).rejects.toThrow(ForbiddenException);
      await expect(service.updateUserAccount("u1", { active: false }, "u1")).rejects.toThrow("無法停用自己的帳號");
      const same = await service.updateUserAccount("u1", { role: UserRole.DIRECTOR, active: true, displayName: "新名字" }, "u1");
      expect(same).toMatchObject({ role: UserRole.DIRECTOR, active: true, displayName: "新名字" });
    });

    it("改別人：角色、啟用狀態、帳號都可以改；沒送的欄位不動", async () => {
      userRepo.findOne.mockResolvedValue(user({ id: "u2", username: "vol", role: UserRole.VOLUNTEER }));
      const result = await service.updateUserAccount("u2", { role: UserRole.FINANCE, active: false }, "u1");
      expect(result).toMatchObject({ username: "vol", displayName: "王總幹事", role: UserRole.FINANCE, active: false });
    });

    it("改成已被使用的帳號名稱：409；其他錯誤原樣往外丟", async () => {
      userRepo.findOne.mockImplementation(async () => user({ id: "u2" }));
      userRepo.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.updateUserAccount("u2", { username: "taken" }, "u1")).rejects.toThrow(ConflictException);
      const dbError = otherDbError();
      userRepo.save.mockRejectedValueOnce(dbError);
      await expect(service.updateUserAccount("u2", { username: "taken" }, "u1")).rejects.toBe(dbError);
    });
  });

  describe("updateOwnProfile / changeOwnPassword / resetUserPassword / deleteUserAccount / listUsers", () => {
    it("編輯自己的資料：只會動帳號與顯示名稱；找不到 404；帳號重複 409", async () => {
      await expect(service.updateOwnProfile("x", {})).rejects.toThrow(NotFoundException);
      userRepo.findOne.mockImplementation(async () => user());
      const result = await service.updateOwnProfile("u1", { displayName: "新名字", role: UserRole.VIEWER } as never);
      expect(result).toEqual({ id: "u1", username: "director", displayName: "新名字", role: UserRole.DIRECTOR });
      userRepo.save.mockRejectedValueOnce(uniqueViolation());
      await expect(service.updateOwnProfile("u1", { username: "taken" })).rejects.toThrow(ConflictException);
      const dbError = otherDbError();
      userRepo.save.mockRejectedValueOnce(dbError);
      await expect(service.updateOwnProfile("u1", { username: "taken" })).rejects.toBe(dbError);
    });

    it("變更密碼：找不到 404；目前密碼錯 401 且不存檔；正確時存新密碼的雜湊", async () => {
      await expect(service.changeOwnPassword("x", "correct", "newpass")).rejects.toThrow(NotFoundException);
      userRepo.findOne.mockImplementation(async () => user());
      await expect(service.changeOwnPassword("u1", "wrong", "newpass")).rejects.toThrow("目前密碼不正確");
      expect(userRepo.save).not.toHaveBeenCalled();

      await service.changeOwnPassword("u1", "correct", "newpass");
      const saved = userRepo.save.mock.calls[0][0] as { passwordHash: string };
      expect(await bcrypt.compare("newpass", saved.passwordHash)).toBe(true);
    });

    it("重設密碼：找不到 404；找到就換成新密碼的雜湊", async () => {
      await expect(service.resetUserPassword("x", "abcd")).rejects.toThrow(NotFoundException);
      userRepo.findOne.mockResolvedValue(user());
      await service.resetUserPassword("u1", "abcd");
      expect(await bcrypt.compare("abcd", (userRepo.save.mock.calls[0][0] as { passwordHash: string }).passwordHash)).toBe(true);
    });

    it("刪除帳號：不能刪自己（連查都不查）；找不到 404；找到就刪", async () => {
      await expect(service.deleteUserAccount("u1", "u1")).rejects.toThrow("無法刪除自己的帳號");
      expect(userRepo.findOne).not.toHaveBeenCalled();
      await expect(service.deleteUserAccount("u2", "u1")).rejects.toThrow(NotFoundException);
      userRepo.findOne.mockResolvedValue(user({ id: "u2" }));
      await service.deleteUserAccount("u2", "u1");
      expect(userRepo.remove).toHaveBeenCalled();
    });

    it("帳號列表不含密碼雜湊", async () => {
      userRepo.find.mockResolvedValue([user()]);
      const [listed] = await service.listUsers();
      expect(listed).toEqual({
        id: "u1",
        username: "director",
        displayName: "王總幹事",
        role: UserRole.DIRECTOR,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });
  });
});

describe("JwtStrategy.validate（白箱）", () => {
  const build = (found: object | null) => {
    const userRepo = mockRepo();
    userRepo.findOne.mockResolvedValue(found);
    const config = { get: jest.fn().mockReturnValue("test-secret") };
    return new JwtStrategy(config as never, userRepo as never);
  };
  const payload = { sub: "u1", username: "old-name", role: UserRole.VOLUNTEER };

  it("帳號已被刪除或停用：401（舊 token 立即失效）", async () => {
    await expect(build(null).validate(payload)).rejects.toThrow("帳號不存在或已停用");
    await expect(build({ id: "u1", active: false }).validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it("角色以資料庫目前的值為準，不是 token 簽發當時的值（降級後立即生效）", async () => {
    const strategy = build({ id: "u1", username: "new-name", displayName: "陳志工", role: UserRole.VIEWER, active: true });
    expect(await strategy.validate(payload)).toEqual({ userId: "u1", username: "new-name", displayName: "陳志工", role: UserRole.VIEWER });
  });
});

describe("InventoryService（白箱）", () => {
  let itemRepo: MockRepo;
  let txRepo: MockRepo;
  let userRepo: MockRepo;
  let service: InventoryService;
  const item = (overrides: object = {}) => ({
    id: "i1",
    name: "金紙",
    unit: "包",
    currentStock: 5,
    lowStockThreshold: 5,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  });

  beforeEach(() => {
    itemRepo = mockRepo();
    txRepo = mockRepo();
    userRepo = mockRepo();
    service = new InventoryService(itemRepo as never, txRepo as never, userRepo as never);
    itemRepo.save.mockImplementation(async (row: object) => ({ updatedAt: new Date(), id: "i1", ...row }));
  });

  it("建立：沒給初始庫存當成 0；低庫存的判斷是「小於等於」安全存量", async () => {
    expect(await service.createItem({ name: "香", unit: "支", lowStockThreshold: 0 })).toMatchObject({ currentStock: 0, isLowStock: true });
    expect(await service.createItem({ name: "香", unit: "支", lowStockThreshold: 3, initialStock: 4 })).toMatchObject({ currentStock: 4, isLowStock: false });
    expect(await service.createItem({ name: "香", unit: "支", lowStockThreshold: 3, initialStock: 3 })).toMatchObject({ isLowStock: true });
  });

  it("編輯：找不到 404；同名 409；其他錯誤原樣往外丟", async () => {
    const dto = { name: "新名", unit: "箱", lowStockThreshold: 1 };
    await expect(service.updateItem("x", dto)).rejects.toThrow("找不到物資項目");
    itemRepo.findOne.mockImplementation(async () => item());
    expect(await service.updateItem("i1", dto)).toMatchObject({ name: "新名", unit: "箱", lowStockThreshold: 1 });
    itemRepo.save.mockRejectedValueOnce(uniqueViolation());
    await expect(service.updateItem("i1", dto)).rejects.toThrow(new ConflictException("已有同名的物資項目"));
    const dbError = otherDbError();
    itemRepo.save.mockRejectedValueOnce(dbError);
    await expect(service.updateItem("i1", dto)).rejects.toBe(dbError);
  });

  it("刪除：沒有刪到任何資料列就是 404", async () => {
    itemRepo.delete.mockResolvedValue({ affected: 0 });
    await expect(service.deleteItem("x")).rejects.toThrow(NotFoundException);
    itemRepo.delete.mockResolvedValue({ affected: 1 });
    await expect(service.deleteItem("i1")).resolves.toBeUndefined();
  });

  describe("adjustStock", () => {
    it("品項不存在：404", async () => {
      await expect(service.adjustStock("x", { type: InventoryTransactionType.IN, quantity: 1 }, "u1")).rejects.toThrow(NotFoundException);
    });

    it("進貨：用 increment 累加，不走條件式扣庫存", async () => {
      itemRepo.findOne.mockResolvedValue(item());
      await service.adjustStock("i1", { type: InventoryTransactionType.IN, quantity: 3, note: "補貨" }, "u1");
      expect(itemRepo.increment).toHaveBeenCalledWith({ id: "i1" }, "currentStock", 3);
      expect(itemRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(txRepo.create).toHaveBeenCalledWith({ itemId: "i1", type: "IN", quantity: 3, note: "補貨", createdByUserId: "u1" });
    });

    it("領用：條件式 UPDATE 沒有更新到資料列（庫存不足）→ 409，不留異動紀錄", async () => {
      itemRepo.findOne.mockResolvedValue(item());
      itemRepo.qb.execute.mockResolvedValue({ affected: 0 });
      await expect(service.adjustStock("i1", { type: InventoryTransactionType.OUT, quantity: 9 }, "u1")).rejects.toThrow("庫存不足，無法領用此數量");
      expect(txRepo.save).not.toHaveBeenCalled();
    });

    it("領用成功：UPDATE 的條件包含「庫存 >= 數量」，備註沒填存 null", async () => {
      itemRepo.findOne.mockResolvedValue(item());
      await service.adjustStock("i1", { type: InventoryTransactionType.OUT, quantity: 2 }, "u1");
      expect(itemRepo.qb.where).toHaveBeenCalledWith(`id = :id AND "currentStock" >= :qty`, { id: "i1", qty: 2 });
      expect(itemRepo.increment).not.toHaveBeenCalled();
      expect(txRepo.create).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
    });
  });

  it("異動紀錄：帶品項名稱與經手人；沒有紀錄時不查使用者；品項或使用者已不存在時留空", async () => {
    expect(await service.listTransactions("i1")).toEqual([]);
    expect(userRepo.find).not.toHaveBeenCalled();

    const createdAt = new Date("2026-02-01T00:00:00Z");
    txRepo.find.mockResolvedValue([
      { id: "t1", itemId: "i1", type: "IN", quantity: 1, note: null, createdByUserId: "u1", createdAt },
      { id: "t2", itemId: "i1", type: "OUT", quantity: 1, note: "x", createdByUserId: "gone", createdAt },
    ]);
    userRepo.find.mockResolvedValue([{ id: "u1", displayName: "陳志工" }]);
    const list = await service.listTransactions("i1", 10);
    expect(txRepo.find).toHaveBeenLastCalledWith(expect.objectContaining({ take: 10 }));
    expect(list.map((t) => [t.itemName, t.createdByName])).toEqual([
      ["", "陳志工"],
      ["", ""],
    ]);
  });

  it("列表與低庫存列表", async () => {
    itemRepo.find.mockResolvedValue([item()]);
    itemRepo.qb.getMany.mockResolvedValue([item({ currentStock: 1 })]);
    expect(await service.listItems()).toHaveLength(1);
    expect((await service.listLowStockItems())[0]).toMatchObject({ currentStock: 1, isLowStock: true });
  });
});

describe("PrintService（白箱）", () => {
  const service = new PrintService();
  const internals = service as any;
  const settings = (overrides: object = {}) =>
    ({
      templeName: "測試宮",
      committeeName: null,
      address: null,
      phone: null,
      registrationNo: null,
      taxId: null,
      chairmanTitle: "主任委員",
      templeSealImagePath: null,
      chairmanSealImagePath: null,
      ...overrides,
    }) as never;
  const data = (overrides: object = {}) => ({
    receiptNo: "R20260101123456",
    amount: 1234567,
    status: "ISSUED",
    createdAt: new Date(2026, 4, 17, 12).toISOString(),
    issuedByName: "陳志工",
    payerName: "王小明",
    ...overrides,
  });
  const render = (d: object = {}, s: object = {}) => service.renderReceiptHtml(data(d) as never, settings(s), "http://localhost/");

  it("esc：五種 HTML 特殊字元都會跳脫", () => {
    expect(internals.esc(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#039;y&#039;&gt;&amp;&lt;/a&gt;");
  });

  it("toRocDate：西元年減 1911", () => {
    expect(internals.toRocDate(new Date(2026, 4, 17))).toEqual({ year: 115, month: 5, day: 17 });
    expect(internals.toRocDate(new Date(1912, 0, 1))).toEqual({ year: 1, month: 1, day: 1 });
  });

  it("金額加千分位；日期印民國年；存根聯與收執聯各一份", () => {
    const html = render();
    expect(html).toContain("NT$ 1,234,567");
    expect(html).toContain("日期:中華民國115年5月17日");
    expect(html.match(/class="cert-copy"/g)).toHaveLength(2);
    expect(html.match(/王小明/g)).toHaveLength(2);
  });

  it("已作廢才蓋作廢章", () => {
    expect(render()).not.toContain("作廢 VOID");
    expect(render({ status: "VOIDED" }).match(/作廢 VOID/g)).toHaveLength(2);
  });

  it("沒有姓名時用全形空白佔位，底線不會塌掉", () => {
    expect(render({ payerName: "" })).toContain(`<span class="fill">　</span>`);
  });

  it("印信：有圖用圖片（網址加上防快取參數），沒圖用空白佔位", () => {
    const without = render();
    expect(without).toContain(`<span class="seal-placeholder temple-seal">`);
    expect(without).not.toContain("<img");
    const withSeals = render({}, { templeSealImagePath: "/uploads/seals/a.png", chairmanSealImagePath: "https://x/b.png?v=1" });
    expect(withSeals).toMatch(/src="\/uploads\/seals\/a\.png\?_cb=\d+"/);
    expect(withSeals).toMatch(/src="https:\/\/x\/b\.png\?v=1&amp;_cb=\d+"/);
  });

  it("選填的廟宇資料有填才印；沒有管理委員會名稱時落款用廟名", () => {
    const bare = render();
    expect(bare).not.toContain("立案證號");
    expect(bare).not.toContain("統一編號");
    expect(bare).not.toContain("電話：");
    const full = render({}, { committeeName: "測試宮管理委員會", address: "嘉義縣", phone: "05-123", registrationNo: "A1", taxId: "12345678" });
    for (const text of ["測試宮管理委員會", "嘉義縣", "電話：05-123", "立案證號：A1", "統一編號：12345678"]) expect(full).toContain(text);
  });

  describe("參加項目與備註", () => {
    const items = (count: number, amount = 100) =>
      Array.from({ length: count }, (_, i) => ({ description: `項目${i + 1}`, amount, note: i % 2 === 0 ? `備註${i + 1}` : undefined }));

    it("沒有項目（null 或空陣列）：不印「參加項目」區塊", () => {
      expect(render({ items: null })).not.toContain("參加項目");
      expect(render({ items: [] })).not.toContain("參加項目");
    });

    it("金額 0 的項目（例如送禮）不印金額那一行", () => {
      const html = render({ items: [{ description: "送禮", amount: 0, note: "品項：鮮花x1" }] });
      expect(html).toContain("送禮");
      expect(html).not.toContain(`class="cert-item-amount"`);
      expect(html).toContain(`<div class="cert-seat-note">品項：鮮花x1</div>`);
    });

    it.each([
      [3, 13],
      [4, 12],
      [6, 12],
      [7, 11],
    ])("%d 個項目時字級是 %dpx（邊界：超過 3 個、超過 6 個各縮一級）", (count, fontSize) => {
      const html = render({ items: items(count) });
      expect(html).toContain(`class="cert-item-line" style="font-size:${fontSize}px;"`);
    });

    it("每個備註各自一行，沒有備註的項目不產生空行", () => {
      const html = render({ items: items(3) });
      // 3 個項目裡第 1、3 個有備註；存根聯、收執聯各印一次
      expect(html.match(/class="cert-seat-note"/g)).toHaveLength(4);
    });

    it("項目名稱與備註裡的 HTML 會被跳脫", () => {
      const html = render({ items: [{ description: "<b>x</b>", amount: 1, note: "<i>y</i>" }] });
      expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
      expect(html).toContain("&lt;i&gt;y&lt;/i&gt;");
      expect(html).not.toContain("<b>x</b>");
    });
  });

  it("燈位標籤：祈願與疏文有填才印；用 80mm 版面", () => {
    const base = { wallName: "右牆", slotCode: "A-01", memberName: "王小明", year: 2026, wishText: "", petitionText: "" };
    const bare = service.renderLanternLabelHtml(base);
    expect(bare).toContain("size: 80mm auto");
    expect(bare).not.toContain(`class="wish"`);
    expect(bare).not.toContain("疏文：");
    const full = service.renderLanternLabelHtml({ ...base, wishText: "闔家平安", petitionText: "<疏文>" });
    expect(full).toContain("闔家平安");
    expect(full).toContain("疏文：&lt;疏文&gt;");
  });

  it("版面大小：收據 A4；A5 與有 baseUrl 的分支也正確", () => {
    expect(render()).toContain("size: A4");
    expect(render()).toContain(`<base href="http://localhost/" />`);
    const a5 = internals.wrapPrintPage("t", "", "A5");
    expect(a5).toContain("size: A5");
    expect(a5).not.toContain("<base");
  });
});

describe("GiftService / SettingsService（白箱）", () => {
  it("送禮：每個品項一筆紀錄，備註把品項中文名稱與數量串起來；信徒姓名優先於臨櫃姓名", async () => {
    const giftRepo = mockRepo();
    const household = {
      findMemberById: jest.fn().mockResolvedValue({}),
      findMemberByIdOrNull: jest.fn().mockResolvedValue({ name: "王小明" }),
    };
    const service = new GiftService(giftRepo as never, household as never);
    const items = [
      { giftType: GiftType.FLOWERS, quantity: 2 },
      { giftType: GiftType.LONGEVITY, quantity: 1 },
    ];

    const walkIn = await service.createGiftForCombined({ templeId: "t1", walkInName: "臨櫃", items }, "u1");
    expect(walkIn).toMatchObject({ payerName: "臨櫃", description: "送禮", note: "品項：鮮花x2、壽桃壽麵x1", templeId: "t1" });
    expect(walkIn.gifts).toHaveLength(2);
    expect(household.findMemberById).not.toHaveBeenCalled();

    const member = await service.createGiftForCombined({ templeId: "t1", memberId: "m1", walkInName: "會被蓋掉", items }, "u1");
    expect(member.payerName).toBe("王小明");

    household.findMemberByIdOrNull.mockResolvedValue(null);
    expect((await service.createGiftForCombined({ templeId: "t1", memberId: "m1", items }, "u1")).payerName).toBe("");
    // 沒有信徒也沒有（或只有空白）姓名：400，不建立任何紀錄
    for (const walkInName of [undefined, "", "  "]) {
      await expect(service.createGiftForCombined({ templeId: "t1", walkInName, items }, "u1")).rejects.toThrow(
        "請選擇信徒或填寫送禮人姓名",
      );
    }
    expect(giftRepo.save).toHaveBeenCalledTimes(3);
  });

  it("設定：找不到廟宇 404；印信依種類寫到不同欄位", async () => {
    const templeRepo = mockRepo();
    const service = new SettingsService(templeRepo as never);
    await expect(service.getSettings("x")).rejects.toThrow("找不到此廟宇設定");
    await expect(service.updateSettings("x", {} as never)).rejects.toThrow(NotFoundException);
    await expect(service.updateSealImagePath("x", "temple", "/a.png")).rejects.toThrow(NotFoundException);

    templeRepo.findOne.mockImplementation(async () => ({ id: "t1", name: "中埔", templeName: "測試宮", templeSealImagePath: null, chairmanSealImagePath: null }));
    expect(await service.updateSealImagePath("t1", "temple", "/a.png")).toMatchObject({ templeSealImagePath: "/a.png", chairmanSealImagePath: null });
    expect(await service.updateSealImagePath("t1", "chairman", "/b.png")).toMatchObject({ templeSealImagePath: null, chairmanSealImagePath: "/b.png" });
    expect(await service.updateSettings("t1", { templeName: "新名" } as never)).toMatchObject({ templeName: "新名" });

    templeRepo.find.mockResolvedValue([{ id: "t1", name: "中埔", templeName: "測試宮" }]);
    expect(await service.listTemples()).toEqual([{ id: "t1", name: "中埔" }]);
  });
});
